import { describe, expect, it } from 'vitest'
import type Stripe from 'stripe'
import { customerIdFromInvoice, subscriptionIdFromInvoice } from './stripeInvoice'

describe('subscription invoice identity', () => {
  it('reads the current parent shape', () => {
    const invoice = {
      customer: 'cus_1',
      parent: { subscription_details: { subscription: 'sub_1' } },
    } as unknown as Stripe.Invoice
    expect(subscriptionIdFromInvoice(invoice)).toBe('sub_1')
    expect(customerIdFromInvoice(invoice)).toBe('cus_1')
  })

  it('still reads an older webhook endpoint payload', () => {
    const invoice = { customer: { id: 'cus_2' }, subscription: 'sub_2' } as unknown as Stripe.Invoice
    expect(subscriptionIdFromInvoice(invoice)).toBe('sub_2')
    expect(customerIdFromInvoice(invoice)).toBe('cus_2')
  })

  it('ignores standalone invoices', () => {
    expect(subscriptionIdFromInvoice({ parent: null } as Stripe.Invoice)).toBeNull()
  })
})
