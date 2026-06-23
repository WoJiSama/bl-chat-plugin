import { AbstractTool } from './AbstractTool.js';
import { getBase64Image, normalizeImageUrls } from '../../utils/fileUtils.js';
import { dependencies } from "../../dependence/dependencies.js";
import fs from "fs";
import YAML from "yaml";
import path from "path";

const { mimeTypes } = dependencies;
const DEFAULT_CHAT_IMAGE_EDIT_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_IMAGE_EDIT_URL = 'https://api.openai.com/v1/images/edits';
const IMAGE_EDIT_TIMEOUT_MS = 240000;
const IMAGE_EDIT_PROGRESS_MESSAGES = [
    "好的，我会画。我会照着这张图和你说的方向来，出来就发你看。",
    "好呀，我会画的。你前面说的我也会一起看，不会只盯着这一句。",
    "嗯嗯，我会画。我先按你的要求来，画出来直接发你。",
    "好，我来画这版。参考图我会保留住，再按你说的感觉改。"
];

export class GoogleImageEditTool extends AbstractTool {
    constructor() {
        super();
        this.name = 'googleImageEditTool';
        this.description = '使用Google Gemini处理用户的任意图片（或用户的群聊头像），支持编辑图片内容。当用户请求编辑图片/头像时调用此工具。';
        this.parameters = {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: '用户对图片的处理需求，例如"将图片转为黑白""把这张图的人物换一件衣服"'
                },
                images: {
                    type: 'array',
                    description: '用户提供的图片链接数组，需保留原始URL完整性。QQ头像格式："https://q1.qlogo.cn/g?b=qq&nk=用户QQ号&s=640"',
                    items: { type: 'string' }
                }
            },
            required: ['prompt', 'images'],
            additionalProperties: false
        };
    }

    async func(opts, e) {
        const STREAM = false;

        try {
            const config = this.loadConfig();
            const { prompt } = opts;
            const rawImages = this.normalizeArray(opts.images);

            if (!rawImages.length) {
                return { error: '未检测到有效的图片链接' };
            }

            await this.sendProgress(e, prompt);

            // 处理图片URL
            const images = await normalizeImageUrls(rawImages);

            if (!images.length) {
                return { error: '未检测到有效的图片链接' };
            }

            // 调用API
            const { imageEditApiUrl, imageEditApiKey, imageEditApiModel } = config.imageEditAiConfig || {};
            const apiUrl = imageEditApiUrl || DEFAULT_CHAT_IMAGE_EDIT_URL;
            const apiKey = imageEditApiKey || 'sk-xxxxxx';
            const model = imageEditApiModel || "gemini-3-pro-image-preview";

            const imageUrl = this.shouldUseImageEditEndpoint(apiUrl)
                ? await this.generateImageEdit({ apiUrl, apiKey, model, prompt, images })
                : await this.generateChatImageEdit({ apiUrl, apiKey, model, prompt, images, stream: STREAM });

            const processedUrl = this.extractImageUrl(imageUrl);

            if (processedUrl) {
                await e.reply([segment.image(processedUrl)]);
                return '图片编辑成功';
            }
            return { error: '图片编辑失败' };

        } catch (error) {
            console.error('图片编辑失败:', error);
            return { error: `图片编辑失败: ${error.message}` };
        }
    }

    // ========== 工具方法 ==========

    shouldUseImageEditEndpoint(apiUrl = "") {
        return /\/images\/edits\/?$/i.test(String(apiUrl || ""));
    }

    toImageEditUrl(apiUrl = DEFAULT_IMAGE_EDIT_URL) {
        const url = String(apiUrl || "").trim();
        if (!url) return DEFAULT_IMAGE_EDIT_URL;
        if (/\/images\/edits\/?$/i.test(url)) return url;
        if (/\/chat\/completions\/?$/i.test(url)) return url.replace(/\/chat\/completions\/?$/i, "/images/edits");
        if (/\/v1\/?$/i.test(url)) return url.replace(/\/?$/i, "/images/edits");
        return url;
    }

    async generateChatImageEdit({ apiUrl, apiKey, model, prompt, images, stream = false }) {
        const content = await this.buildImageMessages(prompt, images);
        const response = await this.fetchWithTimeout(apiUrl || DEFAULT_CHAT_IMAGE_EDIT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content }],
                stream,
            }),
        });

        return stream
            ? await this.handleStreamResponse(response)
            : await this.handleChatResponse(response);
    }

    async generateImageEdit({ apiUrl, apiKey, model, prompt, images }) {
        let result = await this.parseImageEditResponse(
            await this.requestImageEdit({ apiUrl, apiKey, model, prompt, images }, "url")
        );

        if (!result.ok && this.shouldRetryWithoutUrlResponseFormat(result.errorMessage)) {
            this.logInfo("[图片编辑] 上游不支持 response_format=url，退回默认返回格式");
            result = await this.parseImageEditResponse(
                await this.requestImageEdit({ apiUrl, apiKey, model, prompt, images })
            );
        }

        if (result.ok) return result.image;
        throw new Error(result.errorMessage);
    }

    async requestImageEdit({ apiUrl, apiKey, model, prompt, images }, responseFormat = "") {
        const formData = await this.buildImageEditFormData({ model, prompt, images, responseFormat });
        return await this.fetchWithTimeout(this.toImageEditUrl(apiUrl), {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
            body: formData,
        });
    }

    async buildImageEditFormData({ model, prompt, images, responseFormat = "" }) {
        const formData = new FormData();
        formData.append("model", model);
        formData.append("prompt", prompt);
        if (responseFormat) formData.append("response_format", responseFormat);

        for (let index = 0; index < images.length; index++) {
            const image = await this.buildImageFile(images[index], index);
            formData.append("image", image.blob, image.filename);
        }

        return formData;
    }

    async buildImageFile(url, index = 0) {
        const imgData = await getBase64Image(url, `image_${index}.png`);

        if (imgData.includes("该图片链接已过期")) {
            throw new Error("该图片下载链接已过期，请重新上传");
        }
        if (imgData.includes("无效的图片下载链接")) {
            throw new Error("无效的图片下载链接，请确保适配器支持且图片未过期");
        }
        if (imgData.includes("无效的图片格式")) {
            throw new Error("无效的图片格式，请重新上传图片");
        }

        const parsed = this.parseDataImage(imgData);
        if (!parsed) throw new Error("图片转换失败，请重新上传图片");

        const ext = mimeTypes.extension(parsed.mimeType) || "png";
        return {
            blob: new Blob([parsed.buffer], { type: parsed.mimeType }),
            filename: `image_${index}.${ext}`,
        };
    }

    parseDataImage(dataUrl = "") {
        const match = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
        if (!match) return null;
        return {
            mimeType: match[1],
            buffer: Buffer.from(match[2], "base64"),
        };
    }

    async fetchWithTimeout(url, options = {}, timeoutMs = IMAGE_EDIT_TIMEOUT_MS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, {
                ...options,
                signal: controller.signal
            });
        } catch (error) {
            if (error?.name === "AbortError") {
                throw new Error(`图片编辑接口超过 ${Math.round(timeoutMs / 1000)} 秒没有返回`);
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    shouldRetryWithoutUrlResponseFormat(errorMessage = "") {
        return /response_format|unsupported|not support|unknown parameter|invalid parameter|不支持|未知参数/i.test(String(errorMessage));
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

    async parseImageEditResponse(response) {
        const data = await this.readJsonResponse(response);
        if (!response.ok) {
            return { ok: false, errorMessage: this.formatApiError(response, data), data };
        }

        const item = data?.data?.[0];
        if (item?.url) {
            this.logInfo("[图片编辑] 上游返回 url");
            return { ok: true, image: item.url, format: "url" };
        }
        if (item?.b64_json) {
            this.logInfo("[图片编辑] 上游返回 b64_json");
            return { ok: true, image: `base64://${item.b64_json}`, format: "b64_json" };
        }

        const chatImage = this.extractChatImageResult(data);
        if (chatImage) return { ok: true, image: chatImage, format: "chat" };

        return { ok: false, errorMessage: "未接收到有效图片", data };
    }

    extractChatImageResult(data) {
        return data?.choices?.[0]?.message?.images?.[0]?.image_url?.url ||
            data?.choices?.[0]?.message?.images?.[0]?.url ||
            data?.choices?.[0]?.message?.content ||
            "";
    }

    logInfo(...args) {
        if (typeof logger !== "undefined" && logger?.info) logger.info(...args);
        else console.info(...args);
    }

    logWarn(...args) {
        if (typeof logger !== "undefined" && logger?.warn) logger.warn(...args);
        else console.warn(...args);
    }

    getProgressMessage(prompt = "") {
        const content = String(prompt || "");
        if (/(引用|回复|上下文|前面|刚才|近期相关对话|被引用内容|用户前面说)/.test(content)) {
            return Math.random() < 0.5
                ? "好呀，我会画的。你前面说的我也会一起看，不会只盯着这一句。"
                : "好的，我会画。我会把这张图和前面那些话一起对上，出来就发你看。";
        }
        return IMAGE_EDIT_PROGRESS_MESSAGES[Math.floor(Math.random() * IMAGE_EDIT_PROGRESS_MESSAGES.length)];
    }

    async sendProgress(e, prompt = "") {
        if (!e?.reply) return;
        try {
            await e.reply(this.getProgressMessage(prompt));
        } catch (error) {
            this.logWarn(`[图片编辑] 发送进度提示失败: ${error.message}`);
        }
    }

    loadConfig() {
        const configPath = path.join(process.cwd(), 'plugins/bl-chat-plugin/config/message.yaml');
        return YAML.parse(fs.readFileSync(configPath, 'utf8')).pluginSettings;
    }

    normalizeArray(input) {
        if (Array.isArray(input)) return input;
        return typeof input === 'string' ? [input] : [];
    }

    async buildImageMessages(prompt, images) {
        const messages = [{ type: "text", text: prompt }];

        for (const url of images) {
            if (!url) continue;

            const imgData = await getBase64Image(url, "other.png");

            if (imgData.includes("该图片链接已过期")) {
                throw new Error("该图片下载链接已过期，请重新上传");
            }
            if (imgData.includes("无效的图片下载链接")) {
                throw new Error("无效的图片下载链接，请确保适配器支持且图片未过期");
            }

            const mimeType = mimeTypes.lookup("other.png") || 'application/octet-stream';
            messages.push(mimeType.startsWith('image/')
                ? { type: "image_url", image_url: { url: imgData } }
                : { type: "file", file_url: { url: imgData } }
            );
        }
        return messages;
    }

    async handleStreamResponse(response) {
        if (!response.ok || !response.body) {
            const data = await this.readJsonResponse(response);
            throw new Error(this.formatApiError(response, data));
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

    async handleChatResponse(response) {
        const data = await this.readJsonResponse(response);
        if (!response.ok) {
            throw new Error(this.formatApiError(response, data));
        }

        const imageUrl = this.extractChatImageResult(data);
        if (!imageUrl) throw new Error("未接收到有效内容");
        return imageUrl;
    }

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

    // ========== 图片URL处理 ==========

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
                ['FF', 'D8'],             // jpeg
                ['89', '50', '4E', '47'], // png
                ['47', '49', '46'],       // gif
                ['52', '49', '46', '46'], // webp
                ['42', '4D']              // bmp
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
