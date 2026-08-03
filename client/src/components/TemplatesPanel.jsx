import CollapsibleCard from './CollapsibleCard.jsx'

function TemplatesPanel({ templates, isLoading, onUseTemplate }) {
  return (
    <CollapsibleCard eyebrow="Rychlejší založení" title="Moje šablony" defaultOpen={false}>
      {isLoading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Načítám šablony…</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Zatím tu nic není. Ulož si první akci jako šablonu dole ve formuláři.
        </p>
      ) : (
        <ul className="space-y-3">
          {templates.map((template) => (
            <li
              key={template.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/60 p-3 dark:border-slate-700 dark:bg-slate-950/30"
            >
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{template.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {template.location}
                  {template.requirePhone ? ' · telefon povinný' : ''}
                </p>
              </div>
              <button type="button" className="secondary-button shrink-0" onClick={() => onUseTemplate(template)}>
                Použít
              </button>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleCard>
  )
}

export default TemplatesPanel
