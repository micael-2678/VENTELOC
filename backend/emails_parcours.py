"""
E-mails du parcours (docs/venteloc/SPEC.md §5, §8) : annonce, justificatif de propriété, contact, demande de dossier,
alertes, relances du vendeur et de l'acquéreur, NPS après vente.

Le dictionnaire `PARCOURS_EMAIL_TEMPLATES` est enregistré dans `business_model.EMAIL_TEMPLATES` à l'import du module
(server.py l'importe juste après emails_contrats).

Règles communes : `{site_name}` partout, un seul bouton d'action (ajouté par `wrap_email_html`), aucune accolade
littérale, valeurs échappées par `render_email`. Les e-mails de relance (mandat, identité, engagement, 14 j, 30 j, 60 j,
hebdo, alertes, baisse de prix, NPS) sont envoyés avec un lien de désinscription et respectent la préférence
`notifications_opt_out` ; les autres sont transactionnels.
"""
import business_model

PARCOURS_EMAIL_TEMPLATES = {
    # ---------------- Vendeur : annonce ----------------
    "listing_published": {
        "subject": "Votre annonce est en ligne",
        "html": """
        <h2>Votre annonce est publiée</h2>
        <p>Bonjour {name},</p>
        <p>Votre annonce « {property_title} » est maintenant visible des acquéreurs, sans l'adresse exacte du bien ni votre
        identité. {sent_line}</p>
        <p>Vous serez prévenu par e-mail à chaque contact, demande de dossier, engagement de confidentialité signé et offre
        d'achat. Pour aller plus vite : déposez dès maintenant le dossier du bien (bail, quittances, diagnostics, taxe
        foncière, documents de copropriété) depuis <a href="{link}">votre espace</a>, en masquant les données personnelles
        du locataire.</p>
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
        "subject": "14 jours en ligne : trois leviers pour attirer des acquéreurs",
        "html": """
        <h2>Votre annonce n'a pas encore reçu de contact</h2>
        <p>Bonjour {name},</p>
        <p>Votre annonce « {property_title} » est en ligne depuis deux semaines. Voici ce qui fait la différence chez les
        annonces contactées rapidement :</p>
        <ul>
          <li><strong>Une description qui rassure sur le revenu</strong> : ancienneté et sérieux du locataire, travaux récents,
          charges maîtrisées, environnement du bien. Les acquéreurs achètent un loyer qui dure.</li>
          <li><strong>Des chiffres complets</strong> : taxe foncière, charges non récupérables et dépôt de garantie permettent
          d'afficher le rendement net, que les investisseurs comparent.</li>
          <li><strong>Un prix cohérent avec le rendement du marché</strong> : un rendement trop bas filtre les acquéreurs avant
          même le premier message.</li>
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
        <p>Prix demandé : <strong>{asking_price}</strong>. Fourchette indicative calculée à partir de votre loyer et de vos charges :
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
        <p>Pour que les acquéreurs ne contactent que des vendeurs joignables, une annonce dont le vendeur ne se connecte plus
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
        des acquéreurs. Rien n'est supprimé et votre mandat court toujours.</p>
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
        <h2>Nous avons enregistré que votre bien est vendu autrement</h2>
        <p>Bonjour {name},</p>
        <p>Votre annonce est retirée. Votre mandat de vente simple n° {registry_number} était non exclusif : rien n'est dû si la
        vente est conclue avec une personne que nous ne vous avons pas présentée.</p>
        <p>La clause de suite reste applicable jusqu'au <strong>{tail_ends_at}</strong> pour les acquéreurs nommément présentés
        (engagement de confidentialité signé) : <strong>{buyers_list}</strong>. Si la vente est conclue avec l'un d'eux, merci de
        la déclarer depuis votre espace : la rémunération prévue au mandat est alors due à la signature de l'acte authentique et
        réglée par le notaire sur le prix.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "sold_elsewhere_admin": {
        "subject": "[Admin] Annonce déclarée « vendue autrement » : {property_title}",
        "html": """
        <h2>Vente hors plateforme déclarée par le vendeur</h2>
        <p>Annonce {property_id} — {property_title}. Acquéreurs présentés : {buyers_list}.</p>
        <p>Clause de suite applicable jusqu'au {tail_ends_at} pour ces acquéreurs.</p>
        """
    },
    # ---------------- Justificatif de propriété ----------------
    "ownership_received": {
        "subject": "Justificatif de propriété reçu",
        "html": """
        <h2>Nous avons bien reçu votre justificatif</h2>
        <p>Bonjour {name},</p>
        <p>Votre justificatif de propriété ({doc_label}) pour l'annonce « {property_title} » est enregistré. Il est visible de
        vous et de notre équipe seulement, jamais des acquéreurs.</p>
        <p>Nous le contrôlons rapidement : une fois validé, votre annonce affiche le badge « Propriétaire vérifié ». Le dépôt
        suffit à la publication ; vous serez prévenu par e-mail du résultat du contrôle.</p>
        <p>Suivre votre annonce : <a href="{link}">votre espace</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "ownership_verified": {
        "subject": "Propriétaire vérifié : votre justificatif est validé",
        "html": """
        <h2>Votre justificatif de propriété est validé</h2>
        <p>Bonjour {name},</p>
        <p>Nous avons contrôlé votre justificatif de propriété pour l'annonce « {property_title} ». Votre annonce affiche
        désormais le badge « Propriétaire vérifié », qui rassure les acquéreurs.</p>
        <p>Retrouvez votre annonce dans <a href="{link}">votre espace</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "ownership_rejected": {
        "subject": "Votre justificatif de propriété n'a pas pu être validé",
        "html": """
        <h2>Justificatif de propriété refusé</h2>
        <p>Bonjour {name},</p>
        <p>Nous n'avons pas pu valider le justificatif de propriété déposé pour l'annonce « {property_title} ».</p>
        <p>Motif : <strong>{note}</strong></p>
        <p>{unpublished_line} Déposez un nouveau document (titre de propriété, attestation notariée, avis de taxe foncière ou
        statuts et Kbis de la société propriétaire) depuis <a href="{link}">votre espace</a> : il sera contrôlé à nouveau.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    # ---------------- Contact et messagerie ----------------
    "first_contact": {
        "subject": "Un acquéreur vous présente son projet : {buyer_label}",
        "html": """
        <h2>Premier contact d'un acquéreur</h2>
        <p>Bonjour {name},</p>
        <p>{buyer_label} vous a écrit au sujet de votre annonce « {property_title} » :</p>
        <blockquote style="border-left:3px solid #e3e7ee;margin:0;padding:8px 12px;color:#374151">{extract}</blockquote>
        <p>Sa carte acquéreur :</p>
        <ul>{card_rows}</ul>
        <p>Son identité est vérifiée et il signe un engagement de confidentialité et de non-contournement avant toute
        révélation de l'adresse du bien et de votre nom. Répondez depuis <a href="{link}">la messagerie</a> : une réponse
        rapide double les chances d'aboutir.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "new_contact": {
        "subject": "Un acquéreur vous présente son projet",
        "html": """
        <h2>Premier contact d'un acquéreur</h2>
        <p>Bonjour {name},</p>
        <p>Un acquéreur vous a écrit au sujet de votre annonce. Sa carte acquéreur et son message vous attendent dans
        <a href="{link}">la messagerie</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "contact_sent_buyer": {
        "subject": "Votre message a été transmis au vendeur",
        "html": """
        <h2>Message transmis</h2>
        <p>Bonjour {name},</p>
        <p>Votre message au vendeur de l'annonce « {property_title} » lui a été transmis avec votre carte acquéreur (projet,
        budget, apport, financement, zones, rendement visé, horizon). Vous recevrez un e-mail dès sa réponse.</p>
        <p>Vous pouvez dès maintenant demander l'accès au dossier depuis <a href="{link}">la conversation</a>. Après acceptation,
        trois étapes ouvrent le dossier : identité vérifiée, engagement de confidentialité signé, origine des fonds déclarée.</p>
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
        "subject": "Le vendeur vous a répondu",
        "html": """
        <h2>Réponse du vendeur</h2>
        <p>Bonjour {name},</p>
        <p>Le vendeur d'un bien que vous avez contacté vous a répondu : <a href="{link}">lire sa réponse</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    # ---------------- Demande de dossier ----------------
    "access_request": {
        "subject": "Demande de dossier : {buyer_label}",
        "html": """
        <h2>Un acquéreur demande votre dossier</h2>
        <p>Bonjour {name},</p>
        <p>{buyer_label} demande l'accès au dossier de votre annonce « {property_title} ». Message : {message}</p>
        <ul>{card_rows}</ul>
        <p>Acceptez ou refusez en un geste depuis <a href="{link}">votre espace</a>. Après votre accord, l'acquéreur doit
        vérifier son identité, signer l'engagement de confidentialité et déclarer l'origine de ses fonds avant de voir le moindre
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
        la demande expirera le {expires_at} et l'acquéreur en sera informé.</p>
        <p>Acceptez ou refusez en un geste depuis <a href="{link}">votre espace</a>. Accepter n'engage à rien : l'acquéreur
        devra d'abord vérifier son identité, signer l'engagement de confidentialité et déclarer l'origine de ses fonds.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "dataroom_accepted": {
        "subject": "Dossier accepté : trois étapes avant l'accès",
        "html": """
        <h2>Le vendeur vous ouvre son dossier</h2>
        <p>Bonjour {name},</p>
        <p>Votre demande de dossier pour « {property_title} » est acceptée. L'accès s'ouvre automatiquement dès que ces étapes
        sont faites, dans l'ordre :</p>
        <ol>{checklist}</ol>
        <p>Tout se fait en ligne depuis <a href="{link}">votre dossier</a>. L'identité est vérifiée en quelques minutes (pièce
        d'identité et selfie) ; l'engagement de confidentialité se signe par code reçu par e-mail.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "access_validated": {
        "subject": "Dossier accepté : trois étapes avant l'accès",
        "html": """
        <h2>Le vendeur vous ouvre son dossier</h2>
        <p>Bonjour {name},</p>
        <p>Votre demande de dossier est acceptée. Depuis votre espace : vérifiez votre identité, signez l'accord de
        confidentialité (il vous révèle l'adresse du bien et l'identité du vendeur) puis déclarez l'origine de vos fonds. L'accès s'ouvre ensuite automatiquement.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "dataroom_auto_accepted": {
        "subject": "Demande de dossier acceptée automatiquement : {buyer_label}",
        "html": """
        <h2>Un acquéreur qualifié accède à votre parcours de dossier</h2>
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
        "subject": "Réponse du vendeur à votre demande de dossier",
        "html": """
        <h2>Demande non retenue</h2>
        <p>Bonjour {name},</p>
        <p>Le vendeur n'a pas donné suite à votre demande de dossier. Motif indiqué : {reason}.</p>
        <p>D'autres biens correspondent peut-être à votre projet : <a href="{link}">voir les annonces</a> ou créez une alerte
        pour recevoir les prochaines.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "dataroom_request_expired": {
        "subject": "Le vendeur n'a pas répondu à votre demande de dossier",
        "html": """
        <h2>Demande expirée après 10 jours</h2>
        <p>Bonjour {name},</p>
        <p>Le vendeur de l'annonce « {property_title} » n'a pas répondu à votre demande de dossier dans les 10 jours. Nous l'avons
        relancé à deux reprises. Vous pouvez renouveler votre demande depuis <a href="{link}">votre dossier</a> ou poursuivre vos
        recherches : les vendeurs réactifs sont ceux qui vendent.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "dataroom_granted": {
        "subject": "Votre accès au dossier est ouvert",
        "html": """
        <h2>Le dossier est accessible</h2>
        <p>Bonjour {name},</p>
        <p>Identité vérifiée, engagement de confidentialité signé, origine des fonds déclarée : vous avez maintenant accès au dossier
        de « {property_title} » (documents consultables en ligne avec filigrane, fiche de reprise du bail).</p>
        <p>Quand vous êtes prêt, formulez une offre d'achat depuis <a href="{link}">le dossier</a> : elle se signe par code et le
        vendeur y répond en ligne.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "dataroom_granted_seller": {
        "subject": "{buyer_name} accède à votre dossier",
        "html": """
        <h2>Accès au dossier ouvert</h2>
        <p>Bonjour {name},</p>
        <p><strong>{buyer_name}</strong> a terminé les trois étapes (identité vérifiée, engagement de confidentialité signé, origine des
        fonds déclarée) et consulte maintenant votre dossier. Chaque consultation est journalisée et filigranée.</p>
        <p>Vous retrouvez sa déclaration d'origine des fonds et la liste des documents consultés dans <a href="{link}">votre espace</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    # ---------------- Relances acquéreur ----------------
    "buyer_identity_reminder": {
        "subject": "Vérifiez votre identité pour accéder au dossier",
        "html": """
        <h2>Le vendeur vous attend</h2>
        <p>Bonjour {name},</p>
        <p>Le vendeur a accepté votre demande de dossier pour « {property_title} » il y a {days} jour{plural}. La première étape est
        la vérification de votre identité (quelques minutes, pièce d'identité et selfie) : l'adresse du bien n'est révélée qu'après l'engagement de confidentialité.</p>
        <p><a href="{link}">Vérifier mon identité</a></p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "buyer_nda_reminder": {
        "subject": "Signez l'engagement de confidentialité pour découvrir le bien",
        "html": """
        <h2>Il ne reste que l'engagement de confidentialité</h2>
        <p>Bonjour {name},</p>
        <p>Votre identité est vérifiée. Signez l'engagement de confidentialité (code reçu par e-mail) pour que le nom du bien
        « {property_title} » vous soit révélé, puis déclarez l'origine de vos fonds : l'accès au dossier s'ouvre aussitôt.</p>
        <p><a href="{link}">Signer l'engagement de confidentialité</a></p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "buyer_dataroom_unvisited": {
        "subject": "Le dossier de {property_title} vous attend",
        "html": """
        <h2>Vous n'avez pas encore consulté le dossier</h2>
        <p>Bonjour {name},</p>
        <p>Votre accès au dossier de « {property_title} » est ouvert depuis trois jours. Les documents (bail, quittances,
        diagnostics, copropriété) et la fiche de reprise du bail sont consultables en ligne : <a href="{link}">ouvrir le dossier</a>.</p>
        <p>Si votre projet a évolué, dites-le au vendeur dans la messagerie : il y est attentif.</p>
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
        hebdomadaire. L'adresse exacte des biens et l'identité des vendeurs ne sont révélées qu'après un engagement de confidentialité.</p>
        <p>En attendant : <a href="{link}">voir les annonces en ligne</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "alert_new_listing": {
        "subject": "Nouvelle annonce correspondant à votre alerte",
        "html": """
        <h2>Un nouveau bien loué à vendre</h2>
        <p>Bonjour {name},</p>
        <p>Une annonce vient d'être publiée et correspond à votre alerte « {criteria} » :</p>
        {card}
        <p>Le contact avec le vendeur est sans frais pour l'acquéreur : présentez votre projet depuis la fiche.</p>
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
        <p>Le vendeur d'un bien que vous suivez a ramené son prix de {old_price} à <strong>{new_price}</strong> :</p>
        {card}
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    # ---------------- Après la vente ----------------
    "nps_after_sale": {
        "subject": "Comment s'est passée la vente ?",
        "html": """
        <h2>Votre avis en un clic</h2>
        <p>Bonjour {name},</p>
        <p>La vente de {property_label} est confirmée. Recommanderiez-vous {site_name} à un proche ? Cliquez sur une note de 0
        (pas du tout) à 10 (certainement) :</p>
        <p>{scores}</p>
        <p>Merci : vos réponses servent à améliorer la plateforme, rien d'autre.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
}

business_model.EMAIL_TEMPLATES.update(PARCOURS_EMAIL_TEMPLATES)

__all__ = ["PARCOURS_EMAIL_TEMPLATES"]
