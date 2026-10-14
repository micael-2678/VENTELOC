"""
E-mails des contrats (docs/venteloc/SPEC.md §7, §8) : mandat de vente simple, engagement de confidentialité et de
non-contournement, offre d'achat.

Le dictionnaire `CONTRACT_EMAIL_TEMPLATES` est enregistré dans `business_model.EMAIL_TEMPLATES` à l'import du module
(server.py l'importe juste après business_model).

Règles communes : `{site_name}` partout, un seul bouton d'action (ajouté par `wrap_email_html`), aucune accolade
littérale, valeurs échappées par `render_email`. Les e-mails de ce module sont tous transactionnels.
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
        15 jours depuis votre espace. Pendant les 14 jours qui suivent la signature, vous pouvez vous rétracter : le bouton
        « Résilier » prend alors effet immédiatement et rien n'est dû.</p>
        <p>Votre exemplaire signé, avec son dossier de preuve, est à télécharger ici : <a href="{pdf_link}">télécharger le mandat (PDF)</a>.
        Conservez-le : c'est l'exemplaire qui vous est remis au titre du registre des mandats.</p>
        <p>Honoraires : {bareme}</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "mandate_j30": {
        "subject": "Votre mandat arrive à échéance le {ends_at}",
        "html": """
        <h2>Votre mandat expire dans 30 jours</h2>
        <p>Bonjour {name},</p>
        <p>Votre mandat de vente simple n° {registry_number} prend fin le <strong>{ends_at}</strong>. Sans prolongation,
        votre annonce sera retirée à cette date et les acquéreurs présentés vous seront communiqués par e-mail.</p>
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
        <p>La clause de suite reste applicable pendant 12 mois pour les acquéreurs qui vous ont été nommément présentés :
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
        <p>L'annonce sera dépubliée automatiquement à la date d'effet et la liste des acquéreurs présentés envoyée au mandant.</p>
        """
    },
    "mandate_withdrawn": {
        "subject": "Rétractation de votre mandat n° {registry_number} enregistrée",
        "html": """
        <h2>Rétractation enregistrée</h2>
        <p>Bonjour {name},</p>
        <p>Vous vous êtes rétracté du mandat de vente simple n° {registry_number} ({contract_number}) le {withdrawn_at},
        dans le délai de 14 jours qui suit sa signature. La rétractation prend effet immédiatement : votre annonce
        « {property_title} » n'est plus visible des acquéreurs.</p>
        <p>Aucune somme n'est due et la clause de suite ne s'applique pas. Vous pouvez signer un nouveau mandat à tout
        moment depuis votre espace si vous souhaitez remettre votre bien en vente.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "mandate_withdrawn_admin": {
        "subject": "[Admin] Rétractation du mandat n° {registry_number}",
        "html": """
        <h2>Rétractation d'un mandat</h2>
        <p>Le mandant s'est rétracté du mandat n° {registry_number} ({contract_number}) le {withdrawn_at}, dans le délai de
        14 jours. Effet immédiat : annonce {property_id} ({property_title}) retirée, demandes de dossier en attente closes,
        aucune clause de suite.</p>
        """
    },
    "mandate_ended": {
        "subject": "Fin de votre mandat n° {registry_number} : acquéreurs présentés",
        "html": """
        <h2>{title}</h2>
        <p>Bonjour {name},</p>
        <p>Votre mandat de vente simple n° {registry_number} a pris fin le {ended_at} ({reason}). Votre annonce n'est plus
        visible des acquéreurs.</p>
        <p>Conformément à la clause de suite, la rémunération prévue au mandat reste due si la vente est conclue avant le
        <strong>{tail_ends_at}</strong> avec l'un des acquéreurs que nous vous avons nommément présentés :</p>
        <p><strong>{buyers_list}</strong></p>
        <p>Rien n'est dû pour une vente à toute autre personne. Vous pouvez signer un nouveau mandat à tout moment depuis
        votre espace pour remettre votre annonce en ligne.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    # ---------------- Engagement de confidentialité et de non-contournement ----------------
    "nda_signed_buyer": {
        "subject": "Votre engagement de confidentialité est signé",
        "html": """
        <h2>Engagement de confidentialité signé</h2>
        <p>Bonjour {name},</p>
        <p>Vous avez signé l'engagement de confidentialité et de non-contournement n° {contract_number}. L'adresse du bien et
        l'identité du vendeur vous sont maintenant communiquées dans votre espace, et le vendeur connaît la vôtre.</p>
        <p>Rappel : ne contactez ni le locataire, ni le syndic, ni l'exploitant, et ne vous rendez pas dans le bien sans
        l'accord du vendeur ; les visites sont organisées par le vendeur avec l'accord du locataire.</p>
        <p>Votre exemplaire signé, avec son dossier de preuve : <a href="{pdf_link}">télécharger l'engagement (PDF)</a>.</p>
        <p>Prochaine étape : {next_step}</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "nda_signed_seller": {
        "subject": "Un acquéreur a signé l'engagement de confidentialité",
        "html": """
        <h2>Engagement de confidentialité signé</h2>
        <p>Bonjour {name},</p>
        <p><strong>{buyer_name}</strong> a signé l'engagement de confidentialité et de non-contournement n° {contract_number}
        relatif à votre bien. Il figure désormais sur la liste des acquéreurs présentés et son identité vous est communiquée
        dans votre espace.</p>
        <p>Les visites se font à votre initiative, avec l'accord du locataire (au plus deux heures par jour ouvrable pour
        un logement).</p>
        <p>L'exemplaire signé, avec son dossier de preuve : <a href="{pdf_link}">télécharger l'engagement (PDF)</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    # ---------------- Offre d'achat ----------------
    "offer_received": {
        "subject": "Offre d'achat reçue : {amount}",
        "html": """
        <h2>Vous avez reçu une offre d'achat</h2>
        <p>Bonjour {name},</p>
        <p><strong>{buyer_name}</strong> vous adresse une offre d'achat de <strong>{amount}</strong> ({sale_object}),
        signée électroniquement. Elle est valable jusqu'au <strong>{expires_at}</strong>.</p>
        <p>Depuis votre espace, vous pouvez l'accepter (signature par code), la refuser avec un motif ou faire une
        contre-proposition. Même acceptée, l'offre n'emporte pas vente : l'avant-contrat et l'acte authentique se signent
        chez le notaire. Les honoraires ne sont dus qu'à la signature de l'acte authentique.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "offer_accepted": {
        "subject": "Votre offre de {amount} est acceptée",
        "html": """
        <h2>Offre d'achat acceptée</h2>
        <p>Bonjour {name},</p>
        <p>Le vendeur a accepté et contresigné votre offre d'achat de <strong>{amount}</strong>. L'étape de vente est ouverte
        dans votre espace : renseignez le notaire en charge de la vente, puis préparez l'avant-contrat (promesse ou compromis)
        avec lui.</p>
        <p>L'offre signée par les deux parties, avec son dossier de preuve : <a href="{pdf_link}">télécharger l'offre (PDF)</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "offer_rejected": {
        "subject": "Réponse du vendeur à votre offre de {amount}",
        "html": """
        <h2>Offre non retenue</h2>
        <p>Bonjour {name},</p>
        <p>Le vendeur n'a pas retenu votre offre d'achat de <strong>{amount}</strong>.</p>
        <p>Motif indiqué : {reason}</p>
        <p>Vous pouvez poursuivre l'échange dans la messagerie ou formuler une nouvelle offre depuis votre espace.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "offer_countered": {
        "subject": "Contre-proposition du vendeur : {counter_amount}",
        "html": """
        <h2>Le vendeur vous fait une contre-proposition</h2>
        <p>Bonjour {name},</p>
        <p>En réponse à votre offre de {amount}, le vendeur propose <strong>{counter_amount}</strong>.</p>
        <p>Message du vendeur : {message}</p>
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
        vente est ouverte dans votre espace : renseignez le notaire en charge de la vente.</p>
        <p>L'offre signée, avec son dossier de preuve : <a href="{pdf_link}">télécharger l'offre (PDF)</a>.</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
    "offer_expired": {
        "subject": "Votre offre de {amount} a expiré",
        "html": """
        <h2>Offre expirée</h2>
        <p>Bonjour {name},</p>
        <p>L'offre d'achat de <strong>{amount}</strong> ({role_text}) est arrivée au terme de sa validité le {expires_at}
        sans réponse définitive.</p>
        <p>{next_step}</p>
        <p>Cordialement,<br>L'équipe {site_name}</p>
        """
    },
}

business_model.EMAIL_TEMPLATES.update(CONTRACT_EMAIL_TEMPLATES)

__all__ = ["CONTRACT_EMAIL_TEMPLATES"]
