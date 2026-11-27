/* The Ed25519 public key that page updates must be signed with, as the base64 of its SPKI DER
   encoding. The release signer reads the line below with a regex, so it stays on one line in
   exactly this shape. */
export const RELEASE_UI_PUBLIC_KEY = 'MCowBQYDK2VwAyEA9UkPw96Pc20foxUcdLWA5kxYDc20FFTivXOWH4/7UNw=';
