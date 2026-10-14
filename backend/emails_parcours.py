"""
E-mails du parcours (SPEC §4.1, §4.3, §4.4, §6.1) : compte, contact, demande de dossier, alertes, relances cédant et
repreneur, NPS après vente.

Le dictionnaire `PARCOURS_EMAIL_TEMPLATES` est enregistré dans `business_model.EMAIL_TEMPLATES` à l'import du module
(server.py l'importe juste après emails_contrats). Les clés `listing_published`, `new_contact`, `access_request`,
`access_validated`, `access_rejected`, `dataroom_granted`, `new_message`, `seller_reply` remplacent volontairement les
gabarits de première génération de business_model (carte repreneur, nombre d'alertes servies, checklist, liens).

Règles communes (SPEC §6.1) : `{site_name}` partout, un seul bouton d'action (ajouté par `wrap_email_html`), aucune
accolade littérale, valeurs échappées par `render_email`. Les e-mails de relance (mandat, identité, NDA, 14 j, 30 j,
60 j, hebdo, alertes, baisse de prix, NPS) sont envoyés avec un lien de désinscription et respectent la préférence
`notifications_opt_out` ; les autres sont transactionnels.
"""
import business_model

PARCOURS_EMAIL_TEMPLATES = {
    # ---------------- Cédant : annonce ----------------
    "listing_published": {
        "subject": "Votre annonce est en ligne",
        "html": """
        <h2>Votre annonce est publiée</h2>
        <p>Bonjour {name},</p>
        <p>Votre annonce anonyme « {property_title} » est maintenant visible des repreneurs. {sent_line}</p>
        <p>Vous serez prévenu par e-mail à chaque contact, demande de dossier, accord de confidentialité signé et offre.
        Pour aller plus vite : déposez dès maintenant vos documents dans le dossier (bilans, Kbis, contrats) depuis
        <a href="{link}">votre espace</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "mandate_reminder": {
        "subject": "Signez votre mandat : votre annonce est prête à être publiée",
        "html": """
        <h2>Votre annonce attend votre mandat</h2>
        <p>Bonjour {name},</p>
        <p>Votre annonce est prête depuis {days} jour{plural}. Elle sera publiée immédiatement après la signature de votre
        mandat de vente simple (deux minutes, code reçu par e-mail) : <a href="{link}">signer mon mandat</a>.</p>
        <p><strong>{objection_title}</strong> {objection_text}</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "seller_no_contact_14d": {
        "subject": "14 jours en ligne : trois leviers pour attirer des repreneurs",
        "html": """
        <h2>Votre annonce n'a pas encore reçu de contact</h2>
        <p>Bonjour {name},</p>
        <p>Votre annonce « {property_title} » est en ligne depuis deux semaines. Voici ce qui fait la différence chez les
        annonces contactées rapidement :</p>
        <ul>
          <li><strong>Une description qui raconte l'entreprise</strong> : clientèle, contrats récurrents, équipe, matériel. Les repreneurs
          cherchent ce qui continue après vous.</li>
          <li><strong>Les cases « ce qui rassure »</strong> : contrats d'entretien, référent technique qui reste, décennale à jour.</li>
          <li><strong>Un prix cohérent avec la fourchette d'estimation</strong> : un prix trop haut filtre les repreneurs avant même le premier message.</li>
        </ul>
        <p>Modifiez votre annonce depuis <a href="{link}">votre espace</a> : les changements sont visibles immédiatement.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "seller_price_30d": {
        "subject": "30 jours en ligne : votre prix face à la fourchette d'estimation",
        "html": """
        <h2>Un point sur votre prix après un mois</h2>
        <p>Bonjour {name},</p>
        <p>Votre annonce « {property_title} » est en ligne depuis un mois. {activity_line}</p>
        <p>Prix demandé : <strong>{asking_price}</strong>. Fourchette indicative calculée à partir de vos chiffres :
        <strong>{low} à {high}</strong> ({method}).</p>
        <p>{advice}</p>
        <p>Vous pouvez ajuster le prix ou compléter l'annonce depuis <a href="{link}">votre espace</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "seller_inactive_warning": {
        "subject": "Votre annonce sera mise en pause dans 7 jours",
        "html": """
        <h2>Vous ne vous êtes pas connecté depuis {days} jours</h2>
        <p>Bonjour {name},</p>
        <p>Pour que les repreneurs ne contactent que des cédants joignables, une annonce dont le cédant ne se connecte plus
        est mise en pause après 60 jours sans connexion. Votre annonce « {property_title} » sera mise en pause le
        <strong>{pause_on}</strong>.</p>
        <p>Pour la garder en ligne, il suffit de vous connecter : <a href="{link}">accéder à mon espace</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "seller_listing_paused": {
        "subject": "Votre annonce est mise en pause",
        "html": """
        <h2>Annonce mise en pause</h2>
        <p>Bonjour {name},</p>
        <p>Sans connexion depuis 60 jours, votre annonce « {property_title} » a été mise en pause : elle n'est plus visible
        des repreneurs. Rien n'est supprimé et votre mandat court toujours.</p>
        <p>Pour la remettre en ligne en un clic : <a href="{link}">accéder à mon espace</a>, puis « Remettre en ligne ».</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "seller_weekly": {
        "subject": "Votre semaine sur {site_name}",
        "html": """
        <h2>Récapitulatif de la semaine</h2>
        <p>Bonjour {name},</p>
        <p>{intro}</p>
        <ul>{lines}</ul>
        <p>{todo_line}</p>
        <p><a href="{link}">Ouvrir mon espace</a></p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "sold_elsewhere_tail_clause": {
        "subject": "Vente en dehors de la plateforme : ce que prévoit votre mandat",
        "html": """
        <h2>Nous avons enregistré que votre entreprise est vendue autrement</h2>
        <p>Bonjour {name},</p>
        <p>Votre annonce est retirée. Votre mandat de vente simple n° {registry_number} était non exclusif : rien n'est dû si la
        cession est conclue avec une personne que nous ne vous avons pas présentée.</p>
        <p>La clause de suite reste applicable jusqu'au <strong>{tail_ends_at}</strong> pour les repreneurs nommément présentés
        (accord de confidentialité signé) : <strong>{buyers_list}</strong>. Si la vente est conclue avec l'un d'eux, merci de la
        déclarer depuis votre espace : la rémunération prévue au mandat est alors due à la signature de l'acte.</p>
        <p>Conformément au mandat (article 5) et aux conditions générales, nous suivons les publications légales (BODACC) de la société pendant cette période.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "sold_elsewhere_admin": {
        "subject": "[Admin] Annonce déclarée « vendue autrement » : {company_name}",
        "html": """
        <h2>Vente hors plateforme déclarée par le cédant</h2>
        <p>Annonce {property_id} — {company_name} (SIRET {siret}). Repreneurs présentés : {buyers_list}.</p>
        <p>La société est signalée à la veille BODACC (clause de suite).</p>
        """
    },
    # ---------------- Contact et messagerie ----------------
    "first_contact": {
        "subject": "Un repreneur vous présente son projet : {buyer_label}",
        "html": """
        <h2>Premier contact d'un repreneur</h2>
        <p>Bonjour {name},</p>
        <p>{buyer_label} vous a écrit au sujet de votre annonce « {property_title} » :</p>
        <blockquote style="border-left:3px solid #e3e7ee;margin:0;padding:8px 12px;color:#374151">{extract}</blockquote>
        <p>Sa carte repreneur :</p>
        <ul>{card_rows}</ul>
        <p>Son identité est vérifiée avant toute révélation de votre nom, et il signe un accord de confidentialité avant
        d'accéder à votre dossier. Répondez depuis <a href="{link}">la messagerie</a> : une réponse rapide double les chances
        d'aboutir.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "new_contact": {
        "subject": "Un repreneur vous présente son projet",
        "html": """
        <h2>Premier contact d'un repreneur</h2>
        <p>Bonjour {name},</p>
        <p>Un repreneur vous a écrit au sujet de votre annonce. Sa carte repreneur et son message vous attendent dans
        <a href="{link}">la messagerie</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "contact_sent_buyer": {
        "subject": "Votre message a été transmis au cédant",
        "html": """
        <h2>Message transmis</h2>
        <p>Bonjour {name},</p>
        <p>Votre message au cédant de l'annonce « {property_title} » lui a été transmis avec votre carte repreneur (projet,
        budget, financement, zones, horizon). Vous recevrez un e-mail dès sa réponse.</p>
        <p>Vous pouvez dès maintenant demander l'accès au dossier depuis <a href="{link}">la conversation</a>. Après acceptation,
        trois étapes ouvrent le dossier : identité vérifiée, accord de confidentialité signé, origine des fonds déclarée.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "new_message": {
        "subject": "Nouveau message sur {site_name}",
        "html": """
        <h2>Vous avez un nouveau message</h2>
        <p>Bonjour {name},</p>
        <p>Un message vous attend dans <a href="{link}">la messagerie</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "seller_reply": {
        "subject": "Le cédant vous a répondu",
        "html": """
        <h2>Réponse du cédant</h2>
        <p>Bonjour {name},</p>
        <p>Le cédant d'une entreprise que vous avez contactée vous a répondu : <a href="{link}">lire sa réponse</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    # ---------------- Demande de dossier ----------------
    "access_request": {
        "subject": "Demande de dossier : {buyer_label}",
        "html": """
        <h2>Un repreneur demande votre dossier</h2>
        <p>Bonjour {name},</p>
        <p>{buyer_label} demande l'accès au dossier de votre annonce « {property_title} ». Message : {message}</p>
        <ul>{card_rows}</ul>
        <p>Acceptez ou refusez en un geste depuis <a href="{link}">votre espace</a>. Après votre accord, le repreneur doit
        vérifier son identité, signer l'accord de confidentialité et déclarer l'origine de ses fonds avant de voir le moindre
        document. Sans réponse de votre part, la demande expire après 10 jours.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "dataroom_request_reminder": {
        "subject": "Une demande de dossier attend votre réponse depuis {days} jours",
        "html": """
        <h2>Demande de dossier en attente</h2>
        <p>Bonjour {name},</p>
        <p>{buyer_label} attend votre réponse à sa demande de dossier pour « {property_title} » depuis {days} jours. Sans réponse,
        la demande expirera le {expires_at} et le repreneur en sera informé.</p>
        <p>Acceptez ou refusez en un geste depuis <a href="{link}">votre espace</a>. Accepter n'engage à rien : le repreneur
        devra d'abord vérifier son identité, signer l'accord de confidentialité et déclarer l'origine de ses fonds.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "dataroom_accepted": {
        "subject": "Dossier accepté : trois étapes avant l'accès",
        "html": """
        <h2>Le cédant vous ouvre son dossier</h2>
        <p>Bonjour {name},</p>
        <p>Votre demande de dossier pour « {property_title} » est acceptée. L'accès s'ouvre automatiquement dès que ces étapes
        sont faites, dans l'ordre :</p>
        <ol>{checklist}</ol>
        <p>Tout se fait en ligne depuis <a href="{link}">votre dossier</a>. L'identité est vérifiée en quelques minutes (pièce
        d'identité et selfie) ; l'accord de confidentialité se signe par code reçu par e-mail.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "access_validated": {
        "subject": "Dossier accepté : trois étapes avant l'accès",
        "html": """
        <h2>Le cédant vous ouvre son dossier</h2>
        <p>Bonjour {name},</p>
        <p>Votre demande de dossier est acceptée. Depuis votre espace : vérifiez votre identité, signez l'accord de
        confidentialité (il vous révèle le nom de l'entreprise) puis déclarez l'origine de vos fonds. L'accès s'ouvre ensuite automatiquement.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "dataroom_auto_accepted": {
        "subject": "Demande de dossier acceptée automatiquement : {buyer_label}",
        "html": """
        <h2>Un repreneur qualifié accède à votre parcours de dossier</h2>
        <p>Bonjour {name},</p>
        <p>Conformément à l'option choisie sur votre annonce « {property_title} », la demande de {buyer_label} a été acceptée
        automatiquement (profil complet à plus de 50 %). Il doit maintenant vérifier son identité, signer l'accord de
        confidentialité et déclarer l'origine de ses fonds avant de voir vos documents.</p>
        <ul>{card_rows}</ul>
        <p>Vous pouvez suivre chaque étape et lui écrire depuis <a href="{link}">votre espace</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "access_rejected": {
        "subject": "Réponse du cédant à votre demande de dossier",
        "html": """
        <h2>Demande non retenue</h2>
        <p>Bonjour {name},</p>
        <p>Le cédant n'a pas donné suite à votre demande de dossier. Motif indiqué : {reason}.</p>
        <p>D'autres entreprises correspondent peut-être à votre projet : <a href="{link}">voir les annonces</a> ou créez une alerte
        pour recevoir les prochaines.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "dataroom_request_expired": {
        "subject": "Le cédant n'a pas répondu à votre demande de dossier",
        "html": """
        <h2>Demande expirée après 10 jours</h2>
        <p>Bonjour {name},</p>
        <p>Le cédant de l'annonce « {property_title} » n'a pas répondu à votre demande de dossier dans les 10 jours. Nous l'avons
        relancé à deux reprises. Vous pouvez renouveler votre demande depuis <a href="{link}">votre dossier</a> ou poursuivre vos
        recherches : les cédants réactifs sont ceux qui vendent.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "dataroom_granted": {
        "subject": "Votre accès au dossier est ouvert",
        "html": """
        <h2>Le dossier est accessible</h2>
        <p>Bonjour {name},</p>
        <p>Identité vérifiée, accord de confidentialité signé, origine des fonds déclarée : vous avez maintenant accès au dossier
        de « {property_title} » (documents consultables en ligne avec filigrane, diagnostic de transmissibilité).</p>
        <p>Quand vous êtes prêt, formulez une offre indicative depuis <a href="{link}">le dossier</a> : elle se signe par code et le
        cédant y répond en ligne.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "dataroom_granted_seller": {
        "subject": "{buyer_name} accède à votre dossier",
        "html": """
        <h2>Accès au dossier ouvert</h2>
        <p>Bonjour {name},</p>
        <p><strong>{buyer_name}</strong> a terminé les trois étapes (identité vérifiée, accord de confidentialité signé, origine des
        fonds déclarée) et consulte maintenant votre dossier. Chaque consultation est journalisée et filigranée.</p>
        <p>Vous retrouvez sa déclaration d'origine des fonds et la liste des documents consultés dans <a href="{link}">votre espace</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    # ---------------- Relances repreneur ----------------
    "buyer_identity_reminder": {
        "subject": "Vérifiez votre identité pour accéder au dossier",
        "html": """
        <h2>Le cédant vous attend</h2>
        <p>Bonjour {name},</p>
        <p>Le cédant a accepté votre demande de dossier pour « {property_title} » il y a {days} jour{plural}. La première étape est
        la vérification de votre identité (quelques minutes, pièce d'identité et selfie) : aucun nom d'entreprise n'est révélé avant.</p>
        <p><a href="{link}">Vérifier mon identité</a></p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "buyer_nda_reminder": {
        "subject": "Signez l'accord de confidentialité pour découvrir l'entreprise",
        "html": """
        <h2>Il ne reste que l'accord de confidentialité</h2>
        <p>Bonjour {name},</p>
        <p>Votre identité est vérifiée. Signez l'accord de confidentialité (code reçu par e-mail) pour que le nom de l'entreprise
        « {property_title} » vous soit révélé, puis déclarez l'origine de vos fonds : l'accès au dossier s'ouvre aussitôt.</p>
        <p><a href="{link}">Signer l'accord de confidentialité</a></p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "buyer_dataroom_unvisited": {
        "subject": "Le dossier de {property_title} vous attend",
        "html": """
        <h2>Vous n'avez pas encore consulté le dossier</h2>
        <p>Bonjour {name},</p>
        <p>Votre accès au dossier de « {property_title} » est ouvert depuis trois jours. Les documents (bilans, Kbis, contrats) et le
        diagnostic de transmissibilité sont consultables en ligne : <a href="{link}">ouvrir le dossier</a>.</p>
        <p>Si votre projet a évolué, dites-le au cédant dans la messagerie : il y est attentif.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    # ---------------- Alertes ----------------
    "alert_confirm": {
        "subject": "Confirmez votre alerte",
        "html": """
        <h2>Confirmez votre adresse pour activer l'alerte</h2>
        <p>Bonjour,</p>
        <p>Vous avez demandé à recevoir les nouvelles annonces correspondant à : <strong>{criteria}</strong>.</p>
        <p>Pour activer l'alerte (lien valable 7 jours) : <a href="{link}">{link}</a></p>
        <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : rien ne sera envoyé.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "alert_confirmed": {
        "subject": "Votre alerte est active",
        "html": """
        <h2>Alerte activée</h2>
        <p>Bonjour,</p>
        <p>Vous recevrez chaque nouvelle annonce correspondant à <strong>{criteria}</strong> dès sa publication, et un récapitulatif
        hebdomadaire. Les annonces sont anonymes : le nom de l'entreprise n'est révélé qu'après un accord de confidentialité.</p>
        <p>En attendant : <a href="{link}">voir les annonces en ligne</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "alert_new_listing": {
        "subject": "Nouvelle annonce correspondant à votre alerte",
        "html": """
        <h2>Une nouvelle entreprise à reprendre</h2>
        <p>Bonjour {name},</p>
        <p>Une annonce vient d'être publiée et correspond à votre alerte « {criteria} » :</p>
        {card}
        <p>Le contact avec le cédant est sans frais pour le repreneur : présentez votre projet depuis la fiche.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "alert_digest": {
        "subject": "{count} annonce{plural} cette semaine pour votre alerte",
        "html": """
        <h2>Les annonces de la semaine</h2>
        <p>Bonjour {name},</p>
        <p>{count} nouvelle{plural} annonce{plural} correspond{conj} à votre alerte « {criteria} » :</p>
        {cards}
        <p><a href="{link}">Voir toutes les annonces</a></p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "price_drop": {
        "subject": "Baisse de prix sur une annonce qui vous intéresse",
        "html": """
        <h2>Le prix demandé a baissé</h2>
        <p>Bonjour {name},</p>
        <p>Le cédant d'une entreprise que vous suivez a ramené son prix de {old_price} à <strong>{new_price}</strong> :</p>
        {card}
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    # ---------------- Après la vente ----------------
    "nps_after_sale": {
        "subject": "Comment s'est passée la cession ?",
        "html": """
        <h2>Votre avis en un clic</h2>
        <p>Bonjour {name},</p>
        <p>La vente de {property_label} est confirmée. Recommanderiez-vous {site_name} à un confrère ? Cliquez sur une note de 0
        (pas du tout) à 10 (certainement) :</p>
        <p>{scores}</p>
        <p>Merci : vos réponses servent à améliorer la plateforme, rien d'autre.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
}

business_model.EMAIL_TEMPLATES.update(PARCOURS_EMAIL_TEMPLATES)

__all__ = ["PARCOURS_EMAIL_TEMPLATES"]
