// Carte d'une rubrique du panneau de test (/test) : titre, phrase d'introduction, contenu
const TestPanelSection = ({ id, title, icon: Icon, intro, children, testId }) => (
  <section className="card p-5 sm:p-6 min-w-0" aria-labelledby={id} data-testid={testId}>
    <h2 id={id} className="font-display text-lg font-bold text-brand-navy flex items-center gap-2">
      {Icon && <Icon className="w-5 h-5 shrink-0 text-brand-navy" aria-hidden="true" />}
      {title}
    </h2>
    {intro && <p className="text-sm text-gray-600 mt-1 leading-relaxed">{intro}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

export default TestPanelSection;
