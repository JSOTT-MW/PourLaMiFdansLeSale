// ═══════════════════════════════════════════════════════════════
//  GOOGLE APPS SCRIPT — Envoi automatique de l'ebook par email
//  Gratuit · Hébergé sur Google · Aucun serveur nécessaire
// ═══════════════════════════════════════════════════════════════
//
//  ÉTAPES D'INSTALLATION :
//  1. Ouvrez script.google.com (connectez-vous avec Gmail)
//  2. Créez un "Nouveau projet"
//  3. Collez tout ce code dans l'éditeur
//  4. Modifiez les variables dans la section CONFIG ci-dessous
//  5. Cliquez sur "Déployer" → "Nouveau déploiement"
//     - Type : Application Web
//     - Exécuter en tant que : Moi
//     - Accès : Tout le monde
//  6. Autorisez les permissions demandées
//  7. Copiez l'URL générée et collez-la dans votre landing page
//     (variable SCRIPT_URL dans le fichier HTML)
// ═══════════════════════════════════════════════════════════════

// ── CONFIG (modifiez ces valeurs) ────────────────────────────
const CONFIG = {
  // Votre adresse Gmail (pour recevoir les notifications)
  VOTRE_EMAIL: "votre@gmail.com",

  // L'ID du fichier PDF dans Google Drive
  // Pour trouver l'ID : ouvrez le PDF dans Drive, l'URL ressemble à
  // https://drive.google.com/file/d/XXXXXXXXXXXXXXX/view
  // Copiez la partie XXXXXXXXXXXXXXX
  PDF_DRIVE_ID: "METTEZ_L_ID_DE_VOTRE_PDF_ICI",

  // Titre de l'ebook (affiché dans l'email)
  TITRE_EBOOK: "Titre de votre ebook",

  // Votre nom (affiché dans l'email)
  VOTRE_NOM: "Votre Nom",

  // Prix affiché dans l'email de confirmation
  PRIX: "5 000 FCFA",

  // Nom de la feuille Google Sheets pour enregistrer les commandes
  // (sera créée automatiquement si elle n'existe pas)
  NOM_FEUILLE: "Commandes",
};
// ─────────────────────────────────────────────────────────────


/**
 * Fonction principale : reçoit les données du formulaire HTML
 * et déclenche l'envoi du PDF par email.
 */
function doPost(e) {
  try {
    // Récupère les données envoyées depuis la landing page
    const data = JSON.parse(e.postData.contents);
    const { nom, email, telephone, operateur, reference, date } = data;

    // 1. Enregistre la commande dans Google Sheets
    enregistrerCommande({ nom, email, telephone, operateur, reference, date });

    // 2. Envoie le PDF à l'acheteur
    envoyerPDF(email, nom);

    // 3. Vous notifie par email
    notifierVendeur({ nom, email, telephone, operateur, reference });

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error(err);
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


/**
 * Envoie le PDF par email à l'acheteur avec un message personnalisé.
 */
function envoyerPDF(emailAcheteur, nomAcheteur) {
  // Récupère le fichier PDF depuis Google Drive
  const fichierPDF = DriveApp.getFileById(CONFIG.PDF_DRIVE_ID);
  const blob = fichierPDF.getAs(MimeType.PDF);
  blob.setName(CONFIG.TITRE_EBOOK + ".pdf");

  // Corps de l'email
  const sujet = `Votre ebook — ${CONFIG.TITRE_EBOOK}`;
  const corps = `
Bonjour ${nomAcheteur},

Merci pour votre achat ! Voici votre ebook "${CONFIG.TITRE_EBOOK}" en pièce jointe.

Vous pouvez l'ouvrir directement sur votre téléphone avec n'importe quelle application PDF.

Bonne lecture !

—
${CONFIG.VOTRE_NOM}
  `.trim();

  // Envoie l'email avec le PDF en pièce jointe
  GmailApp.sendEmail(emailAcheteur, sujet, corps, {
    name: CONFIG.VOTRE_NOM,
    attachments: [blob]
  });
}


/**
 * Vous envoie une notification à chaque nouvelle commande.
 */
function notifierVendeur({ nom, email, telephone, operateur, reference }) {
  const sujet = `[Nouvelle vente] ${nom} — ${CONFIG.PRIX}`;
  const corps = `
Nouvelle commande reçue !

Nom        : ${nom}
Email      : ${email}
Téléphone  : ${telephone}
Opérateur  : ${operateur}
Référence  : ${reference || "non fournie"}
Heure      : ${new Date().toLocaleString("fr-SN")}

L'ebook a été envoyé automatiquement.
  `.trim();

  GmailApp.sendEmail(CONFIG.VOTRE_EMAIL, sujet, corps);
}


/**
 * Enregistre chaque commande dans un Google Sheets pour garder une trace.
 * Crée automatiquement la feuille si elle n'existe pas.
 */
function enregistrerCommande({ nom, email, telephone, operateur, reference, date }) {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
             || SpreadsheetApp.create("Commandes Ebook");

  let feuille = ss.getSheetByName(CONFIG.NOM_FEUILLE);

  // Crée la feuille avec les en-têtes si elle n'existe pas encore
  if (!feuille) {
    feuille = ss.insertSheet(CONFIG.NOM_FEUILLE);
    feuille.appendRow(["Date", "Nom", "Email", "Téléphone", "Opérateur", "Référence", "Statut"]);
    feuille.getRange(1, 1, 1, 7).setFontWeight("bold");
  }

  // Ajoute la ligne de commande
  feuille.appendRow([
    date || new Date().toLocaleString("fr-SN"),
    nom,
    email,
    telephone,
    operateur,
    reference || "",
    "PDF envoyé ✓"
  ]);
}


// ═══════════════════════════════════════════════════════════════
//  BONUS : Fonction de test manuel
//  → Dans l'éditeur Apps Script, sélectionnez "testerEnvoi"
//    et cliquez sur Exécuter pour tester sans le formulaire.
// ═══════════════════════════════════════════════════════════════
function testerEnvoi() {
  envoyerPDF(CONFIG.VOTRE_EMAIL, "Test Acheteur");
  console.log("Email de test envoyé à " + CONFIG.VOTRE_EMAIL);
}
