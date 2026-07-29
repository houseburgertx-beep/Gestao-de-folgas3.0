/**
 * URL pública do Web App do Google Apps Script responsável por gravar
 * as selfies no Google Drive. O endpoint valida o token do Firebase antes
 * de aceitar cada imagem; nenhuma credencial do Drive fica no navegador.
 */
export const SELFIE_DRIVE_UPLOAD_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbzNlFEnYAGp3GOS0jD6f2rQ-qklOe4fO8hDUDbYD_ANi_aJcPxpJKReDsQJP2rkTwd0/exec";
