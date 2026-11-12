const nodemailer = require('nodemailer');

function getTransporter() {
  const host = process.env.SMTP_HOST || 'smtp-relay.brevo.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || ''
    }
  });
}

/**
 * Envía el código de verificación al correo institucional del docente
 */
async function sendVerificationEmail(email, code, nombre = 'Docente') {
  const isSmtpConfigured = !!(process.env.SMTP_USER && process.env.SMTP_PASS);

  const subject = `Código de verificación SREI: ${code}`;
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;">
      <div style="background-color: #1E3A8A; color: white; padding: 24px; text-align: center;">
        <h1 style="margin: 0; font-size: 20px;">Sistema de Registro Estudiantil Inclusivo (SREI)</h1>
        <p style="margin: 6px 0 0 0; opacity: 0.85; font-size: 13px;">Verificación de Cuenta Docente</p>
      </div>
      <div style="padding: 30px; background-color: #FFFFFF; color: #1F2937;">
        <p style="font-size: 15px; margin-top: 0;">Estimado(a) <strong>${nombre}</strong>,</p>
        <p style="font-size: 14px; line-height: 1.6; color: #4B5563;">
          Has solicitado registrar tu cuenta de profesor en el SREI. Introduce el siguiente código de verificación de 6 dígitos para validar tu correo electrónico:
        </p>
        <div style="text-align: center; margin: 25px 0;">
          <span style="display: inline-block; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #1E3A8A; background-color: #EFF6FF; padding: 12px 28px; border-radius: 8px; border: 2px dashed #3B82F6;">
            ${code}
          </span>
        </div>
        <p style="font-size: 13px; color: #6B7280; text-align: center;">
          Este código es válido durante los próximos 15 minutos. Si no solicitaste esta cuenta, ignora este mensaje.
        </p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="font-size: 12px; color: #9CA3AF; text-align: center; margin-bottom: 0;">
          Una vez verificado tu correo, tu cuenta quedará en revisión para activación por parte del Director del plantel escolar.
        </p>
      </div>
      <div style="background-color: #F8FAFC; padding: 14px; text-align: center; font-size: 11px; color: #64748B;">
        © 2025 SREI • Educación Inclusiva • Servicio Comunitario
      </div>
    </div>
  `;

  if (isSmtpConfigured) {
    try {
      const transporter = getTransporter();
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || `"SREI Inclusión" <${process.env.SMTP_USER}>`,
        to: email,
        subject: subject,
        html: html
      });
      console.log(`[Email Service] Correo SMTP enviado a ${email}: MessageId=${info.messageId}`);
      return { success: true, delivered: true };
    } catch (error) {
      console.error(`[Email Service] Error enviando correo SMTP a ${email}:`, error.message);
      // Fallback para no bloquear la operación
      return { success: true, delivered: false, fallbackCode: code, error: error.message };
    }
  } else {
    console.log(`=======================================================`);
    console.log(`[EMAIL SERVICE (Modo Local/Desarrollo)]`);
    console.log(`Destinatario: ${email} (${nombre})`);
    console.log(`CÓDIGO DE VERIFICACIÓN: [ ${code} ]`);
    console.log(`Para envíos reales configura SMTP_USER y SMTP_PASS en .env`);
    console.log(`=======================================================`);
    return { success: true, delivered: false, simulated: true, code };
  }
}

module.exports = { sendVerificationEmail };

