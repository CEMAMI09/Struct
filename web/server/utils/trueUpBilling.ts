import { randomUUID } from 'node:crypto'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TIER_FLOORS, type PaidTier, type SubscriptionTier } from './billing'
import { estimateTrueUpCents, type UsagePeriodRow } from './usagePeriods'

const OVERAGE_PRICE_CENTS: Record<PaidTier, number> = {
  flexible: 100,
  pro: 50,
  scale: 20,
}

function dbError(error: { message: string } | null) {
  if (error) throw createError({ statusCode: 500, message: error.message })
}

/** Calendar-month peaks are recorded by record_org_device_peak, not by Stripe's
 * subscription-item billing dates. Close every due ledger period on a draft
 * subscription invoice, including months missed by earlier webhook attempts. */
export async function processClosedUsagePeriods(
  supabase: SupabaseClient,
  stripe: Stripe,
  orgId: string,
  invoiceId: string,
  asOf = new Date(),
) {
  const { data: periods, error } = await supabase
    .from('organization_device_usage_periods')
    .select('*')
    .eq('organization_id', orgId)
    .eq('status', 'open')
    .lte('stripe_period_end', asOf.toISOString())
    .order('stripe_period_end', { ascending: true })
    .limit(100)
  dbError(error)

  // Older versions also created subscription-date rows. A calendar row and a
  // subscription row can represent the same devices. Never charge both by
  // guessing which is authoritative; flag the overlap for reconciliation.
  for (const period of (periods || []) as UsagePeriodRow[]) {
    const { data: overlap, error: overlapError } = await supabase
      .from('organization_device_usage_periods')
      .select('id')
      .eq('organization_id', orgId)
      .neq('id', period.id)
      .lt('stripe_period_start', period.stripe_period_end)
      .gt('stripe_period_end', period.stripe_period_start)
      .limit(1)
      .maybeSingle()
    dbError(overlapError)
    if (overlap) {
      throw createError({
        statusCode: 503,
        message: `Overlapping usage periods need billing reconciliation for organization ${orgId}`,
      })
    }
  }

  for (const period of (periods || []) as UsagePeriodRow[]) {
    await processPeriodTrueUp(supabase, stripe, period, invoiceId)
  }

  return periods?.length || 0
}

export async function processPeriodTrueUp(
  supabase: SupabaseClient,
  stripe: Stripe,
  period: UsagePeriodRow,
  invoiceId: string,
) {
  const claimToken = randomUUID()
  const { data: claimed, error: claimError } = await supabase.rpc('claim_org_usage_true_up', {
    p_period_id: period.id,
    p_claim_token: claimToken,
  })
  dbError(claimError)
  if (!claimed) {
    const { data: latest, error: latestError } = await supabase
      .from('organization_device_usage_periods')
      .select('status')
      .eq('id', period.id)
      .maybeSingle()
    dbError(latestError)
    if (latest?.status === 'open') {
      throw createError({ statusCode: 503, message: 'Usage true-up is in progress' })
    }
    return null // A concurrent delivery completed this period.
  }

  try {
    const tier = claimed.tier as SubscriptionTier
    if (!(tier in TIER_FLOORS)) {
      throw createError({ statusCode: 500, message: `Unknown usage tier for period ${period.id}` })
    }

    const included = claimed.included_paid_quantity ?? TIER_FLOORS[tier]
    const overageQty = Math.max(0, claimed.peak_paid_quantity - included)
    const amountCents = estimateTrueUpCents(tier, included, claimed.peak_paid_quantity)

    if (tier === 'free' || overageQty <= 0 || amountCents <= 0) {
      const { error } = await supabase.rpc('complete_org_usage_true_up', {
        p_period_id: period.id,
        p_claim_token: claimToken,
        p_invoice_item_id: null,
        p_amount_cents: 0,
        p_status: tier === 'free' ? 'void' : 'invoiced',
      })
      dbError(error)
      return { amountCents: 0, overageQty: 0 }
    }

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('stripe_customer_id')
      .eq('id', claimed.organization_id)
      .maybeSingle()
    dbError(orgError)
    if (!org?.stripe_customer_id) {
      throw createError({ statusCode: 402, message: 'Missing Stripe customer for true-up billing' })
    }

    // Stripe idempotency keys can be pruned after 24 hours. Look for the
    // period's existing item before creating one, so a DB failure after the
    // Stripe request remains recoverable even after that window.
    const existing = await findExistingTrueUpItem(
      stripe,
      org.stripe_customer_id,
      period.id,
      new Date(claimed.stripe_period_end),
    )
    if (existing) {
      const existingInvoiceId = typeof existing.invoice === 'string'
        ? existing.invoice : existing.invoice?.id || null
      if (!existingInvoiceId) {
        throw createError({ statusCode: 503, message: 'Pending true-up item needs billing reconciliation' })
      }
      if (existingInvoiceId !== invoiceId) {
        const originalInvoice = await stripe.invoices.retrieve(existingInvoiceId)
        if (originalInvoice.status !== 'open' && originalInvoice.status !== 'paid') {
          throw createError({ statusCode: 503, message: 'Prior true-up invoice needs billing reconciliation' })
        }
      }
    }
    const rate = OVERAGE_PRICE_CENTS[tier as PaidTier]
    const invoiceItem = existing || await stripe.invoiceItems.create({
      customer: org.stripe_customer_id,
      invoice: invoiceId,
      amount: amountCents,
      currency: 'usd',
      period: {
        start: Math.floor(new Date(claimed.stripe_period_start).getTime() / 1000),
        end: Math.floor(new Date(claimed.stripe_period_end).getTime() / 1000),
      },
      description: `Struct device overage (${overageQty} devices @ $${(rate / 100).toFixed(2)}/device)`,
      metadata: {
        orgId: claimed.organization_id,
        usagePeriodId: period.id,
        peakPaidQuantity: String(claimed.peak_paid_quantity),
        includedPaidQuantity: String(included),
      },
    }, { idempotencyKey: `struct:true-up:v1:${period.id}:${invoiceId}` })

    const attachedInvoiceId = typeof invoiceItem.invoice === 'string'
      ? invoiceItem.invoice : invoiceItem.invoice?.id || null
    if (!existing && attachedInvoiceId !== invoiceId) {
      throw createError({ statusCode: 503, message: 'True-up item was not attached to the draft invoice' })
    }

    // Preserve the actual Stripe amount if this was a recovered item.
    const { error: completeError } = await supabase.rpc('complete_org_usage_true_up', {
      p_period_id: period.id,
      p_claim_token: claimToken,
      p_invoice_item_id: invoiceItem.id,
      p_amount_cents: invoiceItem.amount,
      p_status: 'invoiced',
    })
    dbError(completeError)

    return { amountCents: invoiceItem.amount, overageQty, invoiceItemId: invoiceItem.id }
  } catch (err) {
    const { error: releaseError } = await supabase.rpc('release_org_usage_true_up', {
      p_period_id: period.id,
      p_claim_token: claimToken,
    })
    if (releaseError) console.error('[stripe true-up] failed to release claim:', releaseError.message)
    throw err
  }
}

async function findExistingTrueUpItem(
  stripe: Stripe,
  customerId: string,
  periodId: string,
  periodEnd: Date,
) {
  let startingAfter: string | undefined
  const created = { gte: Math.floor(periodEnd.getTime() / 1000) }

  // A bounded scan fails closed rather than risk a duplicate charge if a
  // customer has an unexpectedly large invoice-item history.
  for (let page = 0; page < 100; page++) {
    const result = await stripe.invoiceItems.list({
      customer: customerId,
      created,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    const match = result.data.find((item) => item.metadata?.usagePeriodId === periodId)
    if (match) return match
    if (!result.has_more) return null
    startingAfter = result.data.at(-1)?.id
    if (!startingAfter) break
  }

  throw createError({ statusCode: 500, message: 'Could not finish Stripe true-up reconciliation' })
}
