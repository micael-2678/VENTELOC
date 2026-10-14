"""
E-mails du chantier « contrats v2 » (SPEC §3.2 à §3.5, §6.1) : mandat simple, accord de confidentialité, offre indicative.

Le dictionnaire `CONTRACT_EMAIL_TEMPLATES` est enregistré dans `business_model.EMAIL_TEMPLATES` à l'import du module
(server.py l'importe juste après business_model). Les clés `offer_received`, `offer_accepted` et `offer_rejected`
remplacent volontairement les gabarits de première génération de business_model (montant, lien, motif).

Règles communes (SPEC §6.1) : `{site_name}` partout, un seul bouton d'action (ajouté par `wrap_email_html`), aucune
accolade littérale, valeurs échappées par `render_email`. Les e-mails de ce module sont tous transactionnels.
"""
import business_model

CONTRACT_EMAIL_TEMPLATES = {
    # ---------------- Mandat simple ----------------
    "mandate_signed_pdf": {
        "subject": "Votre mandat n° {registry_number} est signé",
        "html": """
        <h2>Mandat de vente simple signé</h2>
        <p>Bonjour {name},</p>
        <p>Votre mandat de vente simple n° <strong>{registry_number}</strong> ({contract_number}) est signé et contresigné par
        AlterEgo SAS. Il court jusqu'au <strong>{ends_at}</strong> et reste résiliable à tout moment avec un préavis de
        15 jours depuis votre espace.</p>
        <p>Votre exemplaire signé, avec son dossier de preuve, est à télécharger ici : <a href="{pdf_link}">télécharger le mandat (PDF)</a>.
        Conservez-le : c'est l'exemplaire qui vous est remis au titre du registre des mandats.</p>
        <p>Commission : {bareme}</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "mandate_j30": {
        "subject": "Votre mandat arrive à échéance le {ends_at}",
        "html": """
        <h2>Votre mandat expire dans 30 jours</h2>
        <p>Bonjour {name},</p>
        <p>Votre mandat de vente simple n° {registry_number} prend fin le <strong>{ends_at}</strong>. Sans prolongation,
        votre annonce sera retirée à cette date et les repreneurs présentés vous seront communiqués par e-mail.</p>
        <p>Pour poursuivre la vente, prolongez votre mandat de 12 mois en deux minutes (code reçu par e-mail) :
        <a href="{link}">prolonger mon mandat</a>. Vous pourrez toujours le résilier avec un préavis de 15 jours.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "mandate_denounced": {
        "subject": "Résiliation de votre mandat : effet le {effective_at}",
        "html": """
        <h2>Résiliation enregistrée</h2>
        <p>Bonjour {name},</p>
        <p>La résiliation de votre mandat de vente simple n° {registry_number} a été notifiée le {denounced_at} par
        {denounced_by}. Conformément au mandat, elle prend effet après un préavis de 15 jours, soit le
        <strong>{effective_at}</strong> ; votre annonce sera retirée à cette date.</p>
        <p>La clause de suite reste applicable pendant 18 mois pour les repreneurs qui vous ont été nommément présentés :
        leur liste vous sera envoyée à la date d'effet. Rien n'est dû si vous vendez à toute autre personne.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "mandate_denounced_admin": {
        "subject": "[Admin] Mandat n° {registry_number} résilié (effet le {effective_at})",
        "html": """
        <h2>Résiliation d'un mandat</h2>
        <p>Le mandat n° {registry_number} ({contract_number}) a été résilié le {denounced_at} par {denounced_by}.
        Date d'effet : {effective_at}. Annonce {property_id}.</p>
        <p>L'annonce sera dépubliée automatiquement à la date d'effet et la liste des repreneurs présentés envoyée au mandant.</p>
        """
    },
    "mandate_ended": {
        "subject": "Fin de votre mandat n° {registry_number} : repreneurs présentés",
        "html": """
        <h2>{title}</h2>
        <p>Bonjour {name},</p>
        <p>Votre mandat de vente simple n° {registry_number} a pris fin le {ended_at} ({reason}). Votre annonce n'est plus
        visible des repreneurs.</p>
        <p>Conformément à la clause de suite, la rémunération prévue au mandat reste due si la cession est conclue avant le
        <strong>{tail_ends_at}</strong> avec l'un des repreneurs que nous vous avons nommément présentés :</p>
        <p><strong>{buyers_list}</strong></p>
        <p>Rien n'est dû pour une vente à toute autre personne. Vous pouvez signer un nouveau mandat à tout moment depuis
        votre espace pour remettre votre annonce en ligne.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    # ---------------- Accord de confidentialité ----------------
    "nda_signed_buyer": {
        "subject": "Votre accord de confidentialité est signé",
        "html": """
        <h2>Accord de confidentialité signé</h2>
        <p>Bonjour {name},</p>
        <p>Vous avez signé l'accord de confidentialité n° {contract_number}. L'identité de l'entreprise vous est maintenant
        communiquée dans votre espace et le cédant connaît la vôtre.</p>
        <p>Votre exemplaire signé, avec son dossier de preuve : <a href="{pdf_link}">télécharger l'accord (PDF)</a>.</p>
        <p>Prochaine étape : {next_step}</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "nda_signed_seller": {
        "subject": "Un repreneur a signé l'accord de confidentialité",
        "html": """
        <h2>Accord de confidentialité signé</h2>
        <p>Bonjour {name},</p>
        <p><strong>{buyer_name}</strong> a signé l'accord de confidentialité n° {contract_number} relatif à votre entreprise.
        Il figure désormais sur la liste des repreneurs présentés et son identité vous est communiquée dans votre espace.</p>
        <p>L'exemplaire signé, avec son dossier de preuve : <a href="{pdf_link}">télécharger l'accord (PDF)</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    # ---------------- Offre indicative ----------------
    "offer_received": {
        "subject": "Offre indicative reçue : {amount}",
        "html": """
        <h2>Vous avez reçu une offre indicative</h2>
        <p>Bonjour {name},</p>
        <p><strong>{buyer_name}</strong> vous adresse une offre indicative de <strong>{amount}</strong> ({sale_object}),
        signée électroniquement. Elle est valable jusqu'au <strong>{expires_at}</strong>.</p>
        <p>Depuis votre espace, vous pouvez l'accepter (signature par code), la refuser avec un motif ou faire une
        contre-proposition. L'acceptation ouvre l'étape de vente ; la commission n'est due qu'à la signature de l'acte.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "offer_accepted": {
        "subject": "Votre offre de {amount} est acceptée",
        "html": """
        <h2>Offre acceptée</h2>
        <p>Bonjour {name},</p>
        <p>Le cédant a accepté et contresigné votre offre indicative de <strong>{amount}</strong>. L'étape de vente est ouverte
        dans votre espace : vous y renseignerez le rédacteur de l'acte et suivrez les prochaines étapes avec vos conseils.</p>
        <p>L'offre signée par les deux parties, avec son dossier de preuve : <a href="{pdf_link}">télécharger l'offre (PDF)</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "offer_rejected": {
        "subject": "Réponse du cédant à votre offre de {amount}",
        "html": """
        <h2>Offre non retenue</h2>
        <p>Bonjour {name},</p>
        <p>Le cédant n'a pas retenu votre offre indicative de <strong>{amount}</strong>.</p>
        <p>Motif indiqué : {reason}</p>
        <p>Vous pouvez poursuivre l'échange dans la messagerie ou formuler une nouvelle offre depuis votre espace.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "offer_countered": {
        "subject": "Contre-proposition du cédant : {counter_amount}",
        "html": """
        <h2>Le cédant vous fait une contre-proposition</h2>
        <p>Bonjour {name},</p>
        <p>En réponse à votre offre de {amount}, le cédant propose <strong>{counter_amount}</strong>.</p>
        <p>Message du cédant : {message}</p>
        <p>Vous pouvez accepter cette contre-proposition depuis votre espace (signature par code) jusqu'au {expires_at},
        ou poursuivre l'échange dans la messagerie.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "offer_counter_accepted": {
        "subject": "Votre contre-proposition de {amount} est acceptée",
        "html": """
        <h2>Contre-proposition acceptée</h2>
        <p>Bonjour {name},</p>
        <p><strong>{buyer_name}</strong> a accepté et signé votre contre-proposition de <strong>{amount}</strong>. L'étape de
        vente est ouverte dans votre espace.</p>
        <p>L'offre signée, avec son dossier de preuve : <a href="{pdf_link}">télécharger l'offre (PDF)</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "offer_expired": {
        "subject": "Votre offre de {amount} a expiré",
        "html": """
        <h2>Offre expirée</h2>
        <p>Bonjour {name},</p>
        <p>L'offre indicative de <strong>{amount}</strong> ({role_text}) est arrivée au terme de sa validité le {expires_at}
        sans réponse définitive.</p>
        <p>{next_step}</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
}

business_model.EMAIL_TEMPLATES.update(CONTRACT_EMAIL_TEMPLATES)

__all__ = ["CONTRACT_EMAIL_TEMPLATES"]
