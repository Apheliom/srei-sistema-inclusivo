const crypto = require('crypto');

/**
 * Genera un hash seguro para la contraseña usando el módulo nativo crypto (scrypt)
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Comprueba si la contraseña ingresada coincide con el hash almacenado
 */
function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), derivedKey);
}

/**
 * Genera un código de 6 dígitos numéricos aleatorios
 */
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateVerificationCode
};

