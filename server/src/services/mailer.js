import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

let transport = null;

function getTransport() {
  if (!config.smtp.host) return null;
  transport ||= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transport;
}

export async function sendMail({ to, subject, text }) {
  const t = getTransport();
  if (t) {
    await t.sendMail({ from: config.smtp.from, to, subject, text });
    return { delivered: true };
  }
  if (config.isProduction) {
    throw new HttpError(503, 'Email delivery is not configured on the server. Please contact MCWD support.');
  }
  // Development only: no SMTP configured, so print the message for the developer.
  if (config.env !== 'test') {
    console.log(`\n──── [dev mail] to ${to} ────\n${subject}\n${text}\n────────────────────────────\n`);
  }
  return { delivered: false };
}

export function verificationEmail(name, code) {
  return {
    subject: `Your SeeWater verification code: ${code}`,
    text: `Hi ${name},\n\nYour SeeWater verification code is ${code}. It expires in 15 minutes.\n\nIf you did not create a SeeWater account, you can ignore this email.`,
  };
}
