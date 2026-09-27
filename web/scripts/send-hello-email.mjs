import { Resend } from 'resend'

const apiKey = process.env.RESEND_API_KEY
if (!apiKey) {
  console.error('Set RESEND_API_KEY in web/.env (replace re_xxxxxxxxx with your Resend API key).')
  process.exit(1)
}

const resend = new Resend(apiKey)

const { data, error } = await resend.emails.send({
  from: 'onboarding@resend.dev',
  to: 'codyemami@gmail.com',
  subject: 'Hello World',
  html: '<p>Congrats on sending your <strong>first email</strong>!</p>',
})

if (error) {
  console.error(error)
  process.exit(1)
}

console.log(data)
