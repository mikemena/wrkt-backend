const formData = require('form-data');
const Mailgun = require('mailgun.js');
const mailgun = new Mailgun(formData);
require('dotenv').config();

const sendPasswordResetEmail = async (email, resetToken) => {
  // For development in simulator/device
  const resetUrl = `wrkt://reset-password?token=${resetToken}`;
  const webUrl = `http://localhost:8081/reset-password?token=${resetToken}`;

  const mg = mailgun.client({
    username: 'api',
    key: process.env.MAILGUN_API_KEY,
    domain: process.env.MAILGUN_DOMAIN
  });

  try {
    const response = await mg.messages.create(process.env.MAILGUN_DOMAIN, {
      from: `WRKT App <mailgun@${process.env.MAILGUN_DOMAIN}>`,
      to: [email],
      subject: 'Reset Your Password - WRKT',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Reset Your Password</h2>
          <p>You requested to reset your password.</p>

          <!-- Mobile App Link -->
          <p style="margin: 20px 0;">
            <a href="${resetUrl}" style="
              background-color: #D93B56;
              color: white;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 25px;
              display: inline-block;
            ">Reset Password in App</a>
          </p>

          <!-- Testing Instructions -->
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Testing in Simulator?</strong></p>
            <p>Copy and run this command in your terminal:</p>
            <code style="background: #e9ecef; padding: 8px; display: block; margin: 10px 0;">
              xcrun simctl openurl booted "${resetUrl}"
            </code>

            <p><strong>Testing in Web Browser?</strong></p>
            <p>Click this link:</p>
            <a href="${webUrl}" style="color: #D93B56;">Open in Browser</a>
          </div>

          <p>If you didn't request this, you can safely ignore this email.</p>
          <p>This link will expire in 1 hour.</p>
        </div>
      `
    });

    console.log('Email sent:', response);
    return response;
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Failed to send reset email');
  }
};

module.exports = {
  sendPasswordResetEmail
};
