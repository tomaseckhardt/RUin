import RowListEditor from './RowListEditor.jsx'
import { useI18n } from '../lib/i18n.js'

function SignupItemEditor({ category, items, onChange, disabled = false }) {
  const { t } = useI18n()
  // Keys under signup.bring / signup.ride, matching the category.
  const copy = (field) => t(`signup.${category}.${field}`)

  return (
    <RowListEditor
      rows={items}
      onChange={onChange}
      fields={[
        { name: 'label', label: copy('itemLabel'), placeholder: copy('itemPlaceholder') },
        { name: 'personName', label: copy('personLabel'), placeholder: copy('personPlaceholder') },
        { name: 'quantity', label: copy('quantityLabel'), type: 'number', min: 1, max: 20, parse: (value) => Number(value) || 1 },
      ]}
      newRow={() => ({ key: crypto.randomUUID(), label: '', personName: '', quantity: 1 })}
      addLabel={copy('addRowLabel')}
      hint={copy('hint')}
      gridClassName="sm:grid-cols-[1fr_1fr_5rem_auto]"
      maxRows={20}
      disabled={disabled}
    />
  )
}

export default SignupItemEditor
