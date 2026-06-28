export const DEFAULT_IMAGE_GENERATION_URL = 'https://api.openai.com/v1/images/generations';

const DEFAULT_IMAGE_GENERATION_MODEL = 'gpt-image-2';
const DEFAULT_IMAGE_GENERATION_SIZE = '1024x1024';

function compactString(value) {
  return String(value || "").trim();
}

function pickFirst(...values) {
  return values.find(value => compactString(value)) || "";
}

function isPlaceholderKey(apiKey) {
  const key = compactString(apiKey);
  return !key || /(?:sk-xxx|sk-xxxxx|sk-xxxxxx|your[-_ ]?key|api[-_ ]?key)/i.test(key);
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizePriority(value) {
  if (value === undefined || value === null || value === "") return null;
  const priority = Number(value);
  return Number.isFinite(priority) && priority > 0 ? priority : null;
}

export function toImageGenerationUrl(apiUrl = DEFAULT_IMAGE_GENERATION_URL) {
  const url = compactString(apiUrl);
  if (!url) return DEFAULT_IMAGE_GENERATION_URL;
  if (/\/images\/generations\/?$/i.test(url)) return url;
  if (/\/images\/edits\/?$/i.test(url)) return url.replace(/\/images\/edits\/?$/i, "/images/generations");
  if (/\/chat\/completions\/?$/i.test(url)) return url.replace(/\/chat\/completions\/?$/i, "/images/generations");
  if (/\/v1\/?$/i.test(url)) return url.replace(/\/?$/i, "/images/generations");
  return url;
}

function normalizeImageGenerationConfig(candidate = {}, fallback = {}) {
  const apiKey = pickFirst(
    candidate.imageGenerationApiKey,
    candidate.apiKey,
    fallback.imageGenerationApiKey,
    fallback.apiKey
  );
  if (isPlaceholderKey(apiKey)) return null;

  const model = pickFirst(
    candidate.imageGenerationApiModel,
    candidate.model,
    fallback.imageGenerationApiModel,
    fallback.model,
    DEFAULT_IMAGE_GENERATION_MODEL
  );
  if (!model) return null;

  const apiUrl = toImageGenerationUrl(pickFirst(
    candidate.imageGenerationApiUrl,
    candidate.apiUrl,
    fallback.imageGenerationApiUrl,
    fallback.apiUrl,
    DEFAULT_IMAGE_GENERATION_URL
  ));

  return {
    name: pickFirst(candidate.name, candidate.label, fallback.name, model),
    apiUrl,
    apiKey,
    model,
    priority: normalizePriority(candidate.imageGenerationPriority ?? candidate.priority),
    size: pickFirst(
      candidate.imageGenerationSize,
      candidate.size,
      fallback.imageGenerationSize,
      fallback.size,
      DEFAULT_IMAGE_GENERATION_SIZE
    )
  };
}

function dedupeConfigs(configs) {
  const seen = new Set();
  return configs.filter(config => {
    const key = [config.apiUrl, config.model, config.size, config.apiKey].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function orderConfigs(configs) {
  const ordered = configs.map((config, index) => ({ ...config, _order: index }));
  ordered.sort((a, b) => {
    const aHasPriority = Number.isFinite(a.priority);
    const bHasPriority = Number.isFinite(b.priority);
    if (aHasPriority && bHasPriority && a.priority !== b.priority) return a.priority - b.priority;
    if (aHasPriority !== bHasPriority) return aHasPriority ? -1 : 1;
    return a._order - b._order;
  });

  return dedupeConfigs(ordered).map(({ _order, ...config }) => config);
}

function hasGenerationFields(cfg = {}) {
  return Boolean(
    cfg.imageGenerationApiUrl ||
    cfg.imageGenerationApiModel ||
    cfg.imageGenerationApiKey ||
    cfg.apiUrl ||
    cfg.model ||
    cfg.apiKey
  );
}

function getProviderList(generationCfg = {}) {
  return [
    ...asArray(generationCfg.providers),
    ...asArray(generationCfg.imageGenerationProviders),
    ...asArray(generationCfg.imageGenerationCandidates)
  ];
}

function getFallbackList(generationCfg = {}) {
  return asArray(generationCfg.imageGenerationFallbacks);
}

function shouldUseLegacyGenerationConfig(generationCfg = {}, editCfg = {}) {
  const editModel = compactString(editCfg.imageEditApiModel);
  const editUrl = compactString(editCfg.imageEditApiUrl);
  return Boolean(
    hasGenerationFields(generationCfg) ||
    generationCfg.imageGenerationSize ||
    editCfg.imageGenerationApiUrl ||
    editCfg.imageGenerationApiModel ||
    editCfg.imageGenerationApiKey ||
    editCfg.imageGenerationSize ||
    /^gpt-image/i.test(editModel) ||
    /\/images\/(?:edits|generations)\/?$/i.test(editUrl) ||
    /souimagery\.fun/i.test(editUrl)
  );
}

function buildLegacyFallback(generationCfg = {}, editCfg = {}) {
  const editModel = compactString(editCfg.imageEditApiModel);
  return {
    imageGenerationApiUrl: pickFirst(
      generationCfg.imageGenerationApiUrl,
      editCfg.imageGenerationApiUrl,
      editCfg.imageEditApiUrl,
      DEFAULT_IMAGE_GENERATION_URL
    ),
    imageGenerationApiModel: pickFirst(
      generationCfg.imageGenerationApiModel,
      editCfg.imageGenerationApiModel,
      /^gpt-image/i.test(editModel) ? editModel : DEFAULT_IMAGE_GENERATION_MODEL
    ),
    imageGenerationApiKey: pickFirst(
      generationCfg.imageGenerationApiKey,
      editCfg.imageGenerationApiKey,
      editCfg.imageEditApiKey
    ),
    imageGenerationSize: pickFirst(
      generationCfg.imageGenerationSize,
      editCfg.imageGenerationSize,
      DEFAULT_IMAGE_GENERATION_SIZE
    ),
    imageGenerationPriority: generationCfg.imageGenerationPriority ?? generationCfg.priority,
    name: pickFirst(generationCfg.name, generationCfg.imageGenerationApiModel, editCfg.imageGenerationApiModel, editModel)
  };
}

export function resolveImageGenerationConfigs(config = {}) {
  const generationCfg = config.imageGenerationAiConfig || {};
  const editCfg = config.imageEditAiConfig || {};
  const providerList = getProviderList(generationCfg);

  if (providerList.length) {
    const base = buildLegacyFallback(generationCfg, editCfg);
    const configs = [];
    const primary = normalizeImageGenerationConfig(base);
    if (primary) configs.push(primary);
    configs.push(...providerList
      .map(item => normalizeImageGenerationConfig(item, base))
      .filter(Boolean));
    return orderConfigs(configs);
  }

  const configs = [];
  if (shouldUseLegacyGenerationConfig(generationCfg, editCfg)) {
    const primary = normalizeImageGenerationConfig(buildLegacyFallback(generationCfg, editCfg));
    if (primary) configs.push(primary);
  }

  const fallbackBase = {
    imageGenerationApiUrl: generationCfg.imageGenerationApiUrl || DEFAULT_IMAGE_GENERATION_URL,
    imageGenerationApiKey: generationCfg.imageGenerationApiKey,
    imageGenerationSize: generationCfg.imageGenerationSize || DEFAULT_IMAGE_GENERATION_SIZE
  };
  for (const fallback of getFallbackList(generationCfg)) {
    const normalized = normalizeImageGenerationConfig(fallback, fallbackBase);
    if (normalized) configs.push(normalized);
  }

  return orderConfigs(configs);
}

export function shouldRetryWithoutUrlResponseFormat(errorMessage = "") {
  return /response_format|unsupported|not support|unknown parameter|invalid parameter|不支持|未知参数/i.test(String(errorMessage));
}

export function describeImageGenerationConfig(config = {}, index = 0) {
  const name = compactString(config.name) || compactString(config.model) || `candidate-${index + 1}`;
  const model = compactString(config.model);
  return model && model !== name ? `${name}(${model})` : name;
}

export function buildImageGenerationFailureMessage(errors = []) {
  const details = errors
    .map(item => `${item.label}: ${item.message}`)
    .filter(Boolean)
    .join("；");
  return details ? `所有文生图模型都失败了：${details}` : "所有文生图模型都失败了";
}

export async function generateImageWithFallbacks(configs, prompt, adapter = {}) {
  const candidates = (Array.isArray(configs) ? configs : [configs]).filter(Boolean);
  const errors = [];

  for (let index = 0; index < candidates.length; index++) {
    const config = candidates[index];
    const label = describeImageGenerationConfig(config, index);
    try {
      let result = await adapter.parseResponse(
        await adapter.request(config, prompt, "url")
      );

      if (!result.ok && shouldRetryWithoutUrlResponseFormat(result.errorMessage)) {
        adapter.logInfo?.(`[图片生成] ${label} 不支持 response_format=url，退回默认返回格式`);
        result = await adapter.parseResponse(
          await adapter.request(config, prompt)
        );
      }

      if (result.ok) {
        if (index > 0) adapter.logInfo?.(`[图片生成] fallback 成功: ${label}`);
        return result.image;
      }
      throw new Error(result.errorMessage || "未接收到有效图片");
    } catch (error) {
      const message = String(error?.message || error || "未知错误");
      errors.push({ label, message });
      if (index < candidates.length - 1) {
        adapter.logWarn?.(`[图片生成] ${label} 失败，尝试下一个候选模型: ${message}`);
      }
    }
  }

  throw new Error(buildImageGenerationFailureMessage(errors));
}
