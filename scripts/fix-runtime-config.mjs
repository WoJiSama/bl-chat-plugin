// 一次性：把服务器运行时 config/message.yaml 的 memorySystem 块替换为新字段集。
// 安全保证：先备份 → 仅正则替换 memorySystem 块 → 校验 YAML 可解析且关键键就位 → 否则自动回滚。
import fs from 'fs'

const PATH = '/opt/trss-yunzai/plugins/bl-chat-plugin/config/message.yaml'
const orig = fs.readFileSync(PATH, 'utf8')
fs.writeFileSync(PATH + '.bak-intel-config', orig)

// 保留 enabled:true 与用户调过的 maxFactsPerGroup:100；其余采用新默认。
const NEW_BLOCK = `  memorySystem:
    enabled: true
    maxEntitiesPerGroup: 200
    maxFactsPerGroup: 100
    maxFactsPerEntity: 20
    saveStrictness: normal
    userExtractDebounceSeconds: 90
    userExtractMaxBatchMessages: 6
    groupExtractMinIntervalMinutes: 10
    groupExtractMaxBatchMessages: 12
    promptMaxGroupFacts: 6
    promptMaxChars: 1200
    semanticRecallEnabled: false
    reflectEntityThreshold: 15
    reflectGroupThreshold: 30
    proactiveCallback: true
    recallMaxMentionedEntities: 3
    proactiveWindowDaysBefore: 3
    proactiveWindowDaysAfter: 7
    semanticDupCosine: 0.88
`

// 匹配 "  memorySystem:" 行 + 其后所有 4 空格缩进子行（到下一个 2 空格同级键为止）。
const re = /^  memorySystem:\n(?:    .*\n)*/m
if (!re.test(orig)) { console.error('PATTERN_NOT_FOUND'); process.exit(1) }
const updated = orig.replace(re, NEW_BLOCK)

async function validate(text) {
  try {
    const yaml = (await import('js-yaml')).default
    const doc = yaml.load(text)
    const ms = doc?.pluginSettings?.memorySystem
    if (!ms || ms.enabled !== true || ms.semanticDupCosine !== 0.88 || ms.maxFactsPerGroup !== 100) {
      return 'sanity failed: ' + JSON.stringify(ms)
    }
    return null
  } catch (e) {
    // js-yaml 不可用时退化为结构性检查
    if (String(e.code) === 'ERR_MODULE_NOT_FOUND') {
      if (text.includes('semanticDupCosine: 0.88') && /\n  expressionLearning:/.test(text)) return null
      return 'structural check failed (no js-yaml)'
    }
    return 'yaml parse error: ' + e.message
  }
}

const err = await validate(updated)
if (err) { fs.writeFileSync(PATH, orig); console.error('VALIDATION_FAILED_RESTORED:', err); process.exit(1) }
fs.writeFileSync(PATH, updated)
console.log('CONFIG_UPDATED_OK')
