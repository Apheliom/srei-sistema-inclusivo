# SREI - Sistema de Registro Estudiantil Inclusivo

Sistema web para el registro, seguimiento diagnóstico y generación de reportes institucionales en Educación Inclusiva.

## 🚀 Despliegue Rápido en Render

1. Haz un fork o sube este repositorio a tu cuenta de GitHub.
2. En [Render.com](https://render.com), crea un nuevo **Web Service**.
3. Selecciona el repositorio de GitHub.
4. Parámetros de compilación:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Configura las variables de entorno en Render (ver `.env.example`):
   - `SMTP_HOST`: `smtp.gmail.com`
   - `SMTP_PORT`: `465`
   - `SMTP_SECURE`: `true`
   - `SMTP_USER`: tu correo Gmail
   - `SMTP_PASS`: tu contraseña de aplicación de 16 caracteres
   - `SMTP_FROM`: `"SREI Educación Inclusiva" <tu_correo@gmail.com>`

## 💻 Ejecución Local

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar servidor
npm start

# 3. Restablecer base de datos limpia para producción (opcional)
npm run db:clean
```

## 🔐 Cuenta de Acceso Inicial
- **Usuario:** `director@srei.edu`
- **Contraseña:** `Admin123*`
- **Rol:** Directora (Magister Amparo Aguilar)
