import { AbstractTool } from './AbstractTool.js';
import { getBase64Image, normalizeImageUrls } from '../../utils/fileUtils.js';
import { dependencies } from "../../dependence/dependencies.js";
import fs from "fs";
import YAML from "yaml";
import path from "path";

const { mimeTypes } = dependencies;
const DEFAULT_CHAT_IMAGE_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_IMAGE_GENERATION_URL = 'https://api.openai.com/v1/images/generations';
const IMAGE_GENERATION_TIMEOUT_MS = 240000;
const PROMPT_OPTIMIZATION_TIMEOUT_MS = 30000;
const PROGRESS_MESSAGE_TIMEOUT_MS = 8000;
const IMAGE_GENERATION_PROGRESS_MESSAGES = [
  "嗯嗯，我先把描述整理得清楚一点再画。想把它画得软一点、可爱一点，所以可能会慢一点。",
  "收到，我会先把你的想法整理好再开始画。等我一下下，我不想随便糊弄你。",
  "我先琢磨一下怎么描述会更好看…然后就开始画哦，有点怕画歪，但我会认真一点。"
];
const IMAGE_GENERATION_DONE_MESSAGES = [
  "画好啦，你看看这张顺不顺眼？我尽量把氛围和细节都照顾到了，要是哪里不对我再帮你改。",
  "这张出来啦。我觉得整体氛围还可以，不过有点紧张…你先看看这版行不行。",
  "我画好啦，先给你看这一版。要是风格、脸或者细节有哪里跑偏了，你直接跟我说，我再认真改。"
];
const imageGenerationScopes = new Map();

export class BananaTool extends AbstractTool {
  constructor() {
    super();
    this.name = 'bananaTool';
    this.description = '根据提示词生成图片, 使用nano-banana-2模型进行绘图';
    this.parameters = {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '绘图的描述提示词',
          minLength: 1,
          maxLength: 4000
        },
        images: {
          type: 'array',
          description: '用户提供的图片链接数组，需保留原始URL完整性',
          items: { type: 'string' }
        }
      },
      required: ['prompt'],
      additionalProperties: false
    };
  }

  async func(opts, e) {
    const { prompt } = opts;
    if (!prompt) return "错误：绘图提示词（prompt）不能为空。";

    const job = {
      opts: this.cloneDrawOptions(opts),
      e,
      scopeKey: this.getDrawScopeKey(e),
      requesterName: this.getRequesterDisplayName(e),
      requesterId: e?.user_id || e?.sender?.user_id || "",
      queuedAt: Date.now(),
      notifyFailure: false,
      skipProgressNotice: false
    };
    const queueState = this.getDrawQueueState(job.scopeKey);

    if (queueState.activeTask) {
      job.notifyFailure = true;
      job.skipProgressNotice = true;
      queueState.queue.push(job);
      this.logInfo(`[图片队列] 已排队 scope=${job.scopeKey} requester=${job.requesterName} queue=${queueState.queue.length} active=${queueState.activeTask.requesterName}`);
      await this.replyQueuedDraw(e, queueState);
      return `图片生成已排队，前面还有 ${queueState.queue.length} 个任务`;
    }

    return await this.runDrawJob(job);
  }

  async runDrawJob(job) {
    const queueState = this.getDrawQueueState(job.scopeKey);
    queueState.activeTask = {
      requesterName: job.requesterName,
      requesterId: job.requesterId,
      groupId: job.e?.group_id || "",
      startedAt: Date.now()
    };

    try {
      const result = await this.performDraw(job.opts, job.e, {
        skipProgressNotice: job.skipProgressNotice
      });
      if (job.notifyFailure && this.isErrorResult(result)) {
        await job.e.reply(this.getQueuedFailureMessage());
      }
      return result;
    } finally {
      queueState.activeTask = null;
      this.runNextQueuedDraw(job.scopeKey);
    }
  }

  runNextQueuedDraw(scopeKey) {
    const queueState = this.getDrawQueueState(scopeKey);
    const next = queueState.queue.shift();
    if (!next) {
      this.cleanupDrawQueueState(scopeKey, queueState);
      return;
    }
    this.logInfo(`[图片队列] 开始下一项 scope=${scopeKey} requester=${next.requesterName} remaining=${queueState.queue.length}`);
    this.runDrawJob(next).catch(error => {
      this.logError("[图片队列] 后台绘图任务失败:", error);
      this.cleanupDrawQueueState(scopeKey, queueState);
    });
  }

  async performDraw(opts, e, options = {}) {
    const STREAM = false;
    const config = this.loadConfig();
    const { prompt, images: rawImages } = opts;

    // 处理图片
    const images = await normalizeImageUrls(this.normalizeArray(rawImages));
    const imageGenerationConfig = this.resolveImageGenerationConfig(config);
    if (!options.skipProgressNotice && !images.length && imageGenerationConfig) {
      const progressMessage = await this.generateProgressMessage(config, prompt, e);
      await this.sendProgress(e, progressMessage);
    }
    const optimizedPrompt = await this.optimizePrompt(config, prompt, { hasReferenceImages: images.length > 0 });
    const imgurls = await this.buildImageMessages(optimizedPrompt, images);

    try {
      if (!images.length && imageGenerationConfig) {
        const generatedImage = await this.generateImage(imageGenerationConfig, optimizedPrompt);
        await this.replyImageToRequester(e, generatedImage);
        return '图片生成成功';
      }

      const { imageEditApiUrl: apiUrl, imageEditApiKey: apiKey, imageEditApiModel: model } =
        config.imageEditAiConfig || {};

      const response = await fetch(apiUrl || DEFAULT_CHAT_IMAGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey || 'sk-xxxxxx'}`,
        },
        body: JSON.stringify({
          model: model || "gemini-3-pro-image-preview",
          messages: [{ role: "user", content: imgurls }],
          stream: STREAM,
        }),
      });

      const imageUrl = STREAM
        ? await this.handleStreamResponse(response)
        : await this.handleNormalResponse(response);

      const processedUrl = this.extractImageUrl(imageUrl);

      if (processedUrl) {
        await this.replyImageToRequester(e, processedUrl);
        return '图片编辑成功';
      }
      return { error: '图片编辑失败' };
    } catch (error) {
      console.error('图片生成失败', error);
      return { error: `图片生成失败: ${error.message}` };
    }
  }

  cloneDrawOptions(opts = {}) {
    return {
      ...opts,
      images: Array.isArray(opts.images) ? [...opts.images] : opts.images
    };
  }

  getRequesterDisplayName(e) {
    return String(e?.sender?.card || e?.sender?.nickname || e?.nickname || e?.user_id || "别人")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24);
  }

  getDrawScopeKey(e) {
    if (e?.group_id) return `group:${e.group_id}`;
    return `private:${e?.user_id || e?.sender?.user_id || "unknown"}`;
  }

  getDrawQueueState(scopeKey) {
    const key = scopeKey || "private:unknown";
    let queueState = imageGenerationScopes.get(key);
    if (!queueState) {
      queueState = { activeTask: null, queue: [] };
      imageGenerationScopes.set(key, queueState);
    }
    return queueState;
  }

  cleanupDrawQueueState(scopeKey, queueState) {
    if (!queueState.activeTask && queueState.queue.length === 0) {
      imageGenerationScopes.delete(scopeKey);
    }
  }

  async replyQueuedDraw(e, queueState) {
    const activeTask = queueState?.activeTask;
    const activeName = activeTask?.requesterName || "别人";
    const sameRequester = activeTask?.requesterId &&
      String(activeTask.requesterId) === String(e?.user_id || e?.sender?.user_id || "");
    const message = sameRequester
      ? "我现在还在帮你上一张画画诶，有点忙不过来了…不过这张我也记住了，等上一张画完就来画这张，好不好~"
      : `我现在正在帮「${activeName}」画画诶，有点忙不过来了…不过我已经记住你的了，等我帮那边画完就来帮你画，好不好~`;
    await e.reply(message);
  }

  getQueuedFailureMessage() {
    return "我刚刚轮到这张试了一下，但画出来感觉乱糟糟的，就先不发出来了…有点不好意思。你换个说法再叫我一次，我会再认真试试。";
  }

  isErrorResult(result) {
    if (!result) return false;
    if (typeof result === "string") return /^error[:：]/i.test(result.trim()) || /失败|错误|失敗|錯誤/.test(result);
    return Boolean(result.error);
  }

  logInfo(...args) {
    if (typeof logger !== "undefined" && logger?.info) logger.info(...args);
    else console.info(...args);
  }

  logError(...args) {
    if (typeof logger !== "undefined" && logger?.error) logger.error(...args);
    else console.error(...args);
  }

  resolveImageGenerationConfig(config) {
    const generationCfg = config.imageGenerationAiConfig || {};
    const editCfg = config.imageEditAiConfig || {};
    const apiKey = generationCfg.imageGenerationApiKey || editCfg.imageGenerationApiKey || editCfg.imageEditApiKey;
    if (!apiKey || String(apiKey).includes('sk-xxx')) return null;

    const hasExplicitGenerationConfig = Boolean(
      generationCfg.imageGenerationApiUrl ||
      generationCfg.imageGenerationApiModel ||
      editCfg.imageGenerationApiUrl ||
      editCfg.imageGenerationApiModel
    );
    const editModel = String(editCfg.imageEditApiModel || "");
    const editUrl = String(editCfg.imageEditApiUrl || "");
    const shouldUseGenerationEndpoint = hasExplicitGenerationConfig ||
      /^gpt-image/i.test(editModel) ||
      /\/images\/(?:edits|generations)\/?$/i.test(editUrl) ||
      /souimagery\.fun/i.test(editUrl);
    if (!shouldUseGenerationEndpoint) return null;

    return {
      apiUrl: this.toImageGenerationUrl(
        generationCfg.imageGenerationApiUrl ||
        editCfg.imageGenerationApiUrl ||
        editCfg.imageEditApiUrl ||
        DEFAULT_IMAGE_GENERATION_URL
      ),
      apiKey,
      model: generationCfg.imageGenerationApiModel ||
        editCfg.imageGenerationApiModel ||
        (/^gpt-image/i.test(editModel) ? editModel : "gpt-image-2"),
      size: generationCfg.imageGenerationSize || editCfg.imageGenerationSize || "1024x1024"
    };
  }

  resolvePromptOptimizerConfig(config) {
    const candidates = [
      {
        apiUrl: config.toolsAiConfig?.toolsAiUrl,
        apiKey: config.toolsAiConfig?.toolsAiApikey,
        model: config.toolsAiConfig?.toolsAiModel
      },
      {
        apiUrl: config.chatAiConfig?.chatApiUrl,
        apiKey: this.pickApiKey(config.chatAiConfig?.chatApiKey),
        model: config.chatAiConfig?.chatApiModel
      }
    ];

    return candidates.find(item =>
      item.apiUrl &&
      item.apiKey &&
      item.model &&
      !String(item.apiKey).includes('sk-xxx')
    ) || null;
  }

  pickApiKey(apiKey) {
    if (Array.isArray(apiKey)) {
      const keys = apiKey.filter(key => typeof key === 'string' && key.trim());
      return keys.length ? keys[Math.floor(Math.random() * keys.length)] : "";
    }
    return apiKey || "";
  }

  toChatCompletionsUrl(apiUrl = DEFAULT_CHAT_IMAGE_URL) {
    const url = String(apiUrl || "").trim();
    if (!url) return DEFAULT_CHAT_IMAGE_URL;
    if (/\/chat\/completions\/?$/i.test(url)) return url;
    if (/\/v1\/?$/i.test(url)) return url.replace(/\/?$/i, "/chat/completions");
    return url;
  }

  async optimizePrompt(config, prompt, options = {}) {
    const optimizer = this.resolvePromptOptimizerConfig(config);
    if (!optimizer) return prompt;

    try {
      const response = await this.fetchWithTimeout(this.toChatCompletionsUrl(optimizer.apiUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${optimizer.apiKey}`,
        },
        body: JSON.stringify({
          model: optimizer.model,
          stream: false,
          temperature: 0.4,
          messages: [
            {
              role: "system",
              content: [
                "你是图像生成提示词优化器。",
                "任务：把用户的口语化绘图需求改写成更适合图像生成模型的完整提示词。",
                "只输出优化后的提示词，不要解释，不要 Markdown，不要标题。",
                "必须保留用户明确提出的主体、数量、颜色、动作、关系和风格；不要擅自增加文字、水印、Logo、额外人物或违背用户意图的元素。",
                "可以补充构图、镜头、光线、材质、背景、氛围、细节和质量要求。",
                options.hasReferenceImages
                  ? "如果有参考图片，要写明基于参考图片进行创作，并尽量保留参考图主体/构图/身份特征。"
                  : "如果没有参考图片，要把画面描述得足够具体，便于直接生成。"
              ].join("\n")
            },
            {
              role: "user",
              content: `原始绘图需求：${prompt}`
            }
          ]
        }),
      }, PROMPT_OPTIMIZATION_TIMEOUT_MS);

      if (!response.ok) {
        const data = await this.readJsonResponse(response);
        throw new Error(this.formatApiError(response, data));
      }

      const data = await this.readJsonResponse(response);
      const optimized = this.cleanOptimizedPrompt(data?.choices?.[0]?.message?.content);
      if (optimized) {
        this.logPromptOptimization(prompt, optimized);
        return optimized;
      }
    } catch (error) {
      console.warn('提示词优化失败，使用原始提示词继续绘图:', error.message);
    }

    return prompt;
  }

  cleanOptimizedPrompt(content = "") {
    return String(content || "")
      .replace(/^\s*```[a-zA-Z0-9_-]*\s*/g, "")
      .replace(/\s*```\s*$/g, "")
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .trim()
      .slice(0, 3000);
  }

  logPromptOptimization(originalPrompt, optimizedPrompt) {
    const log = typeof logger !== "undefined" && logger?.info
      ? logger.info.bind(logger)
      : console.info;
    log(`[图片提示词优化] 原始=${String(originalPrompt).slice(0, 120)} 优化后=${String(optimizedPrompt).slice(0, 180)}`);
  }

  toImageGenerationUrl(apiUrl = DEFAULT_IMAGE_GENERATION_URL) {
    const url = String(apiUrl || "").trim();
    if (!url) return DEFAULT_IMAGE_GENERATION_URL;
    if (/\/images\/generations\/?$/i.test(url)) return url;
    if (/\/images\/edits\/?$/i.test(url)) return url.replace(/\/images\/edits\/?$/i, "/images/generations");
    if (/\/chat\/completions\/?$/i.test(url)) return url.replace(/\/chat\/completions\/?$/i, "/images/generations");
    if (/\/v1\/?$/i.test(url)) return url.replace(/\/?$/i, "/images/generations");
    return url;
  }

  buildImageGenerationPayload(imageGenerationConfig, prompt, responseFormat = "") {
    const payload = {
      model: imageGenerationConfig.model,
      prompt,
      n: 1,
      size: imageGenerationConfig.size,
    };
    if (responseFormat) payload.response_format = responseFormat;
    return payload;
  }

  async requestImageGeneration(imageGenerationConfig, prompt, responseFormat = "") {
    return await this.fetchWithTimeout(imageGenerationConfig.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${imageGenerationConfig.apiKey}`,
      },
      body: JSON.stringify(this.buildImageGenerationPayload(imageGenerationConfig, prompt, responseFormat)),
    }, IMAGE_GENERATION_TIMEOUT_MS);
  }

  async generateImage(imageGenerationConfig, prompt) {
    let result = await this.parseImageGenerationResponse(
      await this.requestImageGeneration(imageGenerationConfig, prompt, "url")
    );

    if (!result.ok && this.shouldRetryWithoutUrlResponseFormat(result.errorMessage)) {
      this.logInfo("[图片生成] 上游不支持 response_format=url，退回默认返回格式");
      result = await this.parseImageGenerationResponse(
        await this.requestImageGeneration(imageGenerationConfig, prompt)
      );
    }

    if (result.ok) return result.image;
    throw new Error(result.errorMessage);
  }

  shouldRetryWithoutUrlResponseFormat(errorMessage = "") {
    return /response_format|unsupported|not support|unknown parameter|invalid parameter|不支持|未知参数/i.test(String(errorMessage));
  }

	  async sendProgress(e, message) {
	    try {
	      if (e?.reply && message) await e.reply(message);
	    } catch {}
	  }

  getProgressMessage() {
    return IMAGE_GENERATION_PROGRESS_MESSAGES[
      Math.floor(Math.random() * IMAGE_GENERATION_PROGRESS_MESSAGES.length)
    ];
  }

  async generateProgressMessage(config, prompt, e) {
    const fallback = this.getProgressMessage();
    const generator = this.resolvePromptOptimizerConfig(config);
    if (!generator) return fallback;

    try {
      const requesterName = this.getRequesterDisplayName(e);
      const response = await this.fetchWithTimeout(this.toChatCompletionsUrl(generator.apiUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${generator.apiKey}`,
        },
        body: JSON.stringify({
          model: generator.model,
          stream: false,
          temperature: 0.85,
          messages: [
            {
              role: "system",
              content: [
                "你是QQ群里的少女希洛，正在准备帮群友画图。",
                "任务：根据用户的绘图需求，生成一句自然、动态、不重复的开场回复，告诉对方你准备开始整理提示词并画图。",
                "风格：温柔、积极、有点害羞，但不要茶里茶气，不要客服腔。",
                "要求：只输出一句中文，20到70字；不要 Markdown；不要解释；不要说工具、模型、API、上游、提示词优化器；不要承诺已经画好。"
              ].join("\n")
            },
            {
              role: "user",
              content: [
                `触发者昵称：${requesterName}`,
                `绘图需求：${String(prompt || "").slice(0, 800)}`
              ].join("\n")
            }
          ]
        })
      }, PROGRESS_MESSAGE_TIMEOUT_MS);

      if (!response.ok) {
        const data = await this.readJsonResponse(response);
        throw new Error(this.formatApiError(response, data));
      }

      const data = await this.readJsonResponse(response);
      const message = this.cleanProgressMessage(data?.choices?.[0]?.message?.content);
      return message || fallback;
    } catch (error) {
      this.logInfo(`[图片进度提示] 动态生成失败，使用兜底文案: ${error.message}`);
      return fallback;
    }
  }

  cleanProgressMessage(content = "") {
    const cleaned = String(content || "")
      .replace(/^\s*```[a-zA-Z0-9_-]*\s*/g, "")
      .replace(/\s*```\s*$/g, "")
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) return "";
    if (/(工具|模型|API|api|上游|接口|提示词优化器|已经画好|画好了|完成了)/i.test(cleaned)) return "";
    return cleaned.slice(0, 90);
  }

  getDoneMessage() {
    return IMAGE_GENERATION_DONE_MESSAGES[
      Math.floor(Math.random() * IMAGE_GENERATION_DONE_MESSAGES.length)
    ];
  }

  buildRequesterAtSegment(e) {
    const userId = e?.user_id || e?.sender?.user_id;
    if (!userId) return null;
    if (typeof segment !== "undefined" && typeof segment.at === "function") {
      return segment.at(userId);
    }
    return { type: "at", qq: userId };
  }

  async replyImageToRequester(e, image) {
    const imageSegment = segment.image(image);
    const atSegment = this.buildRequesterAtSegment(e);
    const doneMessage = this.getDoneMessage();
    if (!atSegment) {
      await e.reply([doneMessage, "\n", imageSegment]);
      return;
    }
    await e.reply([atSegment, "\n", doneMessage, "\n", imageSegment]);
  }

  async fetchWithTimeout(url, options = {}, timeoutMs = IMAGE_GENERATION_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`图片接口超过 ${Math.round(timeoutMs / 1000)} 秒没有返回`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  // 加载配置
  loadConfig() {
    const configPath = path.join(process.cwd(), 'plugins/bl-chat-plugin/config/message.yaml');
    return YAML.parse(fs.readFileSync(configPath, 'utf8')).pluginSettings;
  }

  // 数组标准化
  normalizeArray(input) {
    if (Array.isArray(input)) return input;
    return typeof input === 'string' ? [input] : [];
  }

  // 构建图片消息
  async buildImageMessages(prompt, images) {
    const messages = [{ type: "text", text: "你必须至少生成一张高质量的图片:" + prompt }];

    for (const url of images) {
      if (!url) continue;
      const imgData = await getBase64Image(url, "other.png");

      if (imgData.includes("该图片链接已过期") || imgData.includes("无效的图片下载链接")) {
        throw new Error(imgData);
      }

      const mimeType = mimeTypes.lookup("other.png") || 'application/octet-stream';
      messages.push(mimeType.startsWith('image/')
        ? { type: "image_url", image_url: { url: imgData } }
        : { type: "file", file_url: { url: imgData } }
      );
    }
    return messages;
  }

  // 处理流式响应
  async handleStreamResponse(response) {
    if (!response.ok || !response.body) {
      throw new Error(`API请求失败: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      for (const line of decoder.decode(value).split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === "[DONE]") break;

        try {
          const data = JSON.parse(dataStr);
          content += data?.choices?.[0]?.delta?.content || "";
        } catch { }
      }
    }

    if (!content) throw new Error("未接收到有效内容");
    return content;
  }

  // 处理普通响应
  async handleNormalResponse(response) {
    const data = await this.readJsonResponse(response);
    if (!response.ok) {
      throw new Error(this.formatApiError(response, data));
    }
    return data?.choices?.[0]?.message?.images?.[0]?.image_url?.url ||
      data?.choices?.[0]?.message?.images?.[0]?.url ||
      data?.choices?.[0]?.message?.content;
  }

  async parseImageGenerationResponse(response) {
    const data = await this.readJsonResponse(response);
    if (!response.ok) {
      return { ok: false, errorMessage: this.formatApiError(response, data), data };
    }

    const item = data?.data?.[0];
    if (item?.url) {
      this.logInfo("[图片生成] 上游返回 url");
      return { ok: true, image: item.url, format: "url" };
    }
    if (item?.b64_json) {
      this.logInfo("[图片生成] 上游返回 b64_json");
      return { ok: true, image: `base64://${item.b64_json}`, format: "b64_json" };
    }
    return { ok: false, errorMessage: "未接收到有效图片", data };
  }

  async handleImageGenerationResponse(response) {
    const result = await this.parseImageGenerationResponse(response);
    if (result.ok) return result.image;
    throw new Error(result.errorMessage);
  }

  async readJsonResponse(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  formatApiError(response, data) {
    const message = data?.error?.message || data?.detail || data?.raw || response.statusText || "未知错误";
    return `API请求失败: ${response.status} ${message}`;
  }

  // 提取图片URL
  extractImageUrl(content) {
    if (!content) return null;

    // 匹配 Markdown 图片格式: ![xxx](url)
    const mdMatch = content.match(/!\[.*?\]\((data:image\/[^;]+;base64,[^)]+|https?:\/\/[^)]+)\)/);
    if (mdMatch) {
      const url = mdMatch[1];
      if (url.startsWith('data:image')) {
        const base64Data = url.replace(/^data:image\/[^;]+;base64,/, '');
        return `base64://${base64Data}`;
      }
      return url;
    }

    // 匹配纯 base64 data URI
    const base64Match = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
    if (base64Match) {
      return `base64://${base64Match[1]}`;
    }

    // 匹配 https 链接
    const httpsMatch = content.match(/https?:\/\/[^\s)'"<>]+\.(png|jpg|jpeg|gif|webp|bmp)[^\s)'"<>]*/i);
    if (httpsMatch) {
      return httpsMatch[0];
    }

    return null;
  }

  /**
   * 调用OneBotv11 API
   */
  async callApi(action, params = {}) {
    try {
      if (typeof Bot !== 'undefined' && Bot.sendApi) {
        return await Bot.sendApi(action, params);
      } else if (typeof global.bot !== 'undefined' && global.bot.sendApi) {
        return await global.bot.sendApi(action, params);
      } else {
        throw new Error('找不到OneBotv11 API调用接口');
      }
    } catch (error) {
      console.error(`调用API ${action} 失败:`, error);
      throw error;
    }
  }

  async getRKey(url) {
    // 检查URL是否包含rkey参数
    const rkeyMatch = url.match(/rkey=([^&]+)/);
    if (!rkeyMatch) return null;

    try {
      const response = await this.callApi('nc_get_rkey');
      if (response?.status === 'ok' && response?.data?.length >= 2) {
        // 取数组中第二个元素的rkey，去掉开头的"&rkey="
        const rkeyValue = response.data[1].rkey;
        return rkeyValue.replace(/^&rkey=/, '');
      }
    } catch (error) {
      console.error('获取rkey失败:', error);
    }

    // 如果接口调用失败，返回原始rkey
    return rkeyMatch[1];
  }

  // 处理图片URL（腾讯图床等）
  async processImageUrl(url) {
    if (!url?.includes('qq.com')) return url;

    const fid = url.match(/fileid=([^&]+)/)?.[1];
    const rkey = await this.getRKey(url);
    const host = url.slice(0, url.indexOf('&')) || url;

    if (fid && rkey && host) {
      for (let appid = 1408; appid >= 1403; appid--) {
        const newUrl = `${host}/download?appid=${appid}&fileid=${fid}&spec=0&rkey=${rkey}`;
        if (await this.isUrlAvailable(newUrl)) return newUrl;
      }
    }
    return url;
  }

  // 检查URL可用性
  async isUrlAvailable(url) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 5000,
        maxRedirects: 5
      });

      if (response.headers['content-type']?.includes('application/json')) {
        const text = Buffer.from(response.data).toString();
        if (text.includes('retcode') || text.includes('error')) return false;
      }

      const header = [...Buffer.from(response.data).slice(0, 8)]
        .map(b => b.toString(16).padStart(2, '0').toUpperCase());

      const signatures = [
        ['FF', 'D8'],           // jpeg
        ['89', '50', '4E', '47'], // png
        ['47', '49', '46'],      // gif
        ['52', '49', '46', '46'], // webp
        ['42', '4D']            // bmp
      ];

      return signatures.some(sig => sig.every((b, i) => header[i] === b));
    } catch {
      return false;
    }
  }

  async getZaiKey() {
    const res = await fetch('http://localhost:9223/token');
    return (await res.json()).token || '';
  }
}
