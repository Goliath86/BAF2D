/**
 * Errore con chiave di traduzione (vedi config/lang/*.json, sezione "errors").
 * "message" contiene un testo inglese di riserva, usato solo se i file lingua
 * non sono ancora (o non possono essere) caricati.
 */
export class LocalizedError extends Error {
  constructor(key, params = {}, fallbackMessage = key) {
    super(fallbackMessage);
    this.key = key;
    this.params = params;
  }
}
