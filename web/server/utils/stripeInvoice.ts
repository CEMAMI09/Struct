import type Stripe from 'stripe'

/** Webhook endpoints may still be pinned to an older API version than the SDK. */
export function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const current = invoice.parent?.subscription_details?.subscription
  const legacy = (invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null
  }).subscription
  const subscription = current || legacy
  return typeof subscription === 'string' ? subscription : subscription?.id || null
}

export function customerIdFromInvoice(invoice: Stripe.Invoice): string | null {
  return typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id || null
}
