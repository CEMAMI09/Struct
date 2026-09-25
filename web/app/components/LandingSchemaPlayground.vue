<template>
  <section id="schema" class="bg-black py-[72px] sm:py-24" aria-labelledby="schema-heading">
    <div class="mx-auto w-full max-w-[1600px] px-6 sm:px-8">
      <div class="mx-auto max-w-xl text-center">
        <h2 id="schema-heading" class="text-5xl font-semibold tracking-tighter sm:text-6xl">Try a schema</h2>
        <p class="mt-5 text-xl text-white/70">
          Add fields and preview the encoder. Nothing is saved until you create an account.
        </p>
      </div>

      <div class="sandbox mt-16">
        <div class="sandbox-bar">
          <span class="sandbox-dots" aria-hidden="true"><i /><i /><i /></span>
          <p class="sandbox-title">schema sandbox</p>
          <p class="sandbox-live">Live</p>
        </div>

        <div class="sandbox-body">
          <div class="sandbox-fields">
            <div class="mb-4 flex items-center justify-between gap-3">
              <p class="sandbox-kicker">Fields</p>
              <button type="button" class="sandbox-ghost" @click="addField">Add</button>
            </div>
            <ul class="space-y-3">
              <li v-for="(field, index) in fields" :key="index" class="field-row">
                <label class="sr-only" :for="`field-name-${index}`">Field name</label>
                <input
                  :id="`field-name-${index}`"
                  v-model="field.name"
                  class="field-input"
                  spellcheck="false"
                  autocomplete="off"
                />
                <label class="sr-only" :for="`field-type-${index}`">Field type</label>
                <select :id="`field-type-${index}`" v-model="field.type" class="field-input field-type">
                  <option v-for="type in types" :key="type.value" :value="type.value">{{ type.label }}</option>
                </select>
                <button
                  type="button"
                  class="field-remove"
                  :disabled="fields.length === 1"
                  :aria-label="`Remove ${field.name || 'field'}`"
                  @click="removeField(index)"
                >
                  ×
                </button>
              </li>
            </ul>
            <p class="mt-5 text-sm text-white/60">Packed payload {{ totalBytes }} bytes</p>
            <p v-if="codeError" class="mt-2 text-sm text-red-300">{{ codeError }}</p>
          </div>

          <div class="sandbox-code">
            <div class="code-toolbar">
              <label class="sr-only" for="schema-language">Language</label>
              <select id="schema-language" v-model="language" class="lang-select">
                <option v-for="option in CODE_LANGUAGES" :key="option" :value="option">{{ option }}</option>
              </select>
              <button type="button" class="sandbox-ghost" @click="copyCode">{{ copied ? 'Copied' : 'Copy' }}</button>
            </div>
            <a class="sdk-link" href="/sdk/struct-sdk.zip" download>Download device SDK and integration guide</a>
            <pre class="code-view"><code>{{ source }}</code></pre>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { CODE_LANGUAGES, generateSchemaCode, type CodeLanguage } from '#shared/schemaCodegen'
import { TYPE_SIZES, type FieldType, type SchemaField } from '~/types'

type DemoType = Exclude<FieldType, 'flags' | 'char'>

const types: { value: DemoType, label: string }[] = [
  { value: 'float32', label: 'float' },
  { value: 'int32', label: 'int32' },
  { value: 'uint8', label: 'uint8' },
  { value: 'boolean', label: 'bool' },
]

const fields = ref<{ name: string, type: DemoType }[]>([
  { name: 'temp', type: 'float32' },
  { name: 'humidity', type: 'uint8' },
  { name: 'battery', type: 'uint8' },
])

const language = ref<CodeLanguage>('C')
const copied = ref(false)

function sizeOf(type: DemoType) {
  return TYPE_SIZES[type]
}

const totalBytes = computed(() => fields.value.reduce((sum, field) => sum + sizeOf(field.type), 0))

const generated = computed(() => {
  const schema: SchemaField[] = fields.value
    .map((field) => ({ name: field.name.trim(), type: field.type }))
    .filter((field) => field.name)
  if (!schema.length) return { source: 'Add a field to preview an encoder.', error: '' }
  try {
    return { source: generateSchemaCode(schema, 1, language.value).source, error: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'This schema cannot be encoded yet.'
    return { source: '', error: message }
  }
})

const source = computed(() => generated.value.source)
const codeError = computed(() => generated.value.error)

function addField() {
  fields.value.push({ name: `field_${fields.value.length + 1}`, type: 'uint8' })
}

function removeField(index: number) {
  if (fields.value.length === 1) return
  fields.value.splice(index, 1)
}

async function copyCode() {
  if (!source.value) return
  await navigator.clipboard.writeText(source.value)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 1600)
}
</script>

<style scoped>
.sandbox {
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 0.95rem;
  background: #050505;
}

.sandbox-bar {
  display: grid;
  grid-template-columns: 4.5rem 1fr auto;
  align-items: center;
  gap: 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0.7rem 1rem;
}

.sandbox-dots {
  display: flex;
  gap: 0.35rem;
}

.sandbox-dots i {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
}

.sandbox-dots i:first-child { background: #ff5f57; }
.sandbox-dots i:nth-child(2) { background: #febc2e; }
.sandbox-dots i:nth-child(3) { background: #28c840; }

.sandbox-title,
.sandbox-live,
.sandbox-kicker {
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}

.sandbox-title { text-align: center; }
.sandbox-live { color: #b79bff; }

.sandbox-body {
  display: grid;
  min-height: 28rem;
}

@media (min-width: 900px) {
  .sandbox-body {
    grid-template-columns: minmax(18rem, 0.72fr) 1.28fr;
  }
}

.sandbox-fields {
  padding: 1.25rem 1.15rem 1.4rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

@media (min-width: 900px) {
  .sandbox-fields {
    border-bottom: 0;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
  }
}

.field-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 7.25rem auto;
  gap: 0.55rem;
  align-items: center;
}

.field-input,
.lang-select {
  min-height: 2.6rem;
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 0.7rem;
  background: #0c0d10;
  padding: 0 0.8rem;
  color: #fff;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.95rem;
}

.field-input:focus,
.lang-select:focus {
  border-color: #b79bff;
  outline: none;
}

.field-remove,
.sandbox-ghost {
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 0.7rem;
  background: transparent;
  color: #fff;
}

.field-remove {
  width: 2rem;
  height: 2rem;
  font-size: 1rem;
  line-height: 1;
}

.field-remove:disabled { opacity: 0.35; }

.sandbox-code {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 1rem 1rem 1.15rem;
}

.code-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.lang-select { width: auto; min-width: 8.5rem; }

.sandbox-ghost {
  min-height: 2.6rem;
  padding: 0 0.95rem;
  font-size: 0.85rem;
}

.sdk-link {
  display: inline-block;
  margin: 0.9rem 0 0.75rem;
  color: #b79bff;
  font-size: 0.95rem;
  text-decoration: underline;
  text-underline-offset: 0.18em;
}

.code-view {
  margin: 0;
  flex: 1;
  overflow: auto;
  white-space: pre;
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-size: 0.78rem;
  line-height: 1.65;
  color: #d7ccff;
}
</style>
