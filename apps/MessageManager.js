import { MessageManager } from '../utils/MessageManager.js'
import { messageArchiveManager } from '../utils/MessageArchiveManager.js'
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { buildBilibiliArchiveRelaySegments, cleanupBilibiliArchiveRelayFiles } from '../utils/bilibiliMediaRelay.js';
import { getInstalledMessagePipeline } from '../utils/messagePipeline/runtime.js';

function readMessageCacheOptions() {
    const root = process.cwd();
    const defaultPath = path.join(root, 'plugins/bl-chat-plugin/config_default/message.yaml');
    const userPath = path.join(root, 'plugins/bl-chat-plugin/config/message.yaml');
    const readSettings = file => {
        try {
            return fs.existsSync(file) ? (YAML.parse(fs.readFileSync(file, 'utf8'))?.pluginSettings || {}) : {};
        } catch (error) {
            logger.warn(`[MessageRecord] 读取近期消息 TTL 配置失败：${error.message}`);
            return {};
        }
    };
    const defaults = readSettings(defaultPath);
    const user = readSettings(userPath);
    return {
        cacheExpireMinutes: user.groupChatMemoryMinutes ?? defaults.groupChatMemoryMinutes ?? 60,
        cacheExpireDays: user.groupChatMemoryDays ?? defaults.groupChatMemoryDays
    };
}

export class MessageRecordPlugin extends plugin {
    constructor() {
        super({
            name: '消息记录',
            dsc: '记录群聊和私聊消息',
            event: 'message',
            priority: 500,
            task: {
                name: 'messageRecord',
                fnc: () => { },
                cron: ''
            },
            rule: [
                {
                    reg: '^#查看(群聊|私聊)记录\\s*(\\d+)?',
                    fnc: 'showHistory',
                    permission: 'master'
                },
                {
                    reg: '^#清除(群聊|私聊)记录',
                    fnc: 'clearHistory'
                },
                {
                    reg: '^#?(查|搜索)(聊天|群聊)记录[\\s\\S]*',
                    fnc: 'searchArchive'
                },
                {
                    reg: '^[.。]群聊天记录\\s+管理员(添加|删除)[\\s\\S]*',
                    fnc: 'manageArchiveAdmin'
                },
                {
                    reg: '^#?聊天记录管理员(添加|删除)[\\s\\S]*',
                    fnc: 'manageArchiveAdmin'
                },
                {
                    reg: '^[.。]群聊天记录[\\s\\S]*',
                    fnc: 'searchArchive'
                },
                {
                    reg: '^[.。#]消息管道状态(?:\\s+\\d{5,12})?\\s*$',
                    fnc: 'showMessagePipelineStatus',
                    permission: 'master'
                },
                {
                    reg: '^#全局方案(添加|删除)(白名单群组|Gemini密钥|触发前缀|过滤消息|Gemini工具列表|OpenAI工具列表|OneAPI工具列表|OneAPI密钥|GrokSSO|WorkosCursorToken|Gemini代理列表).*$',
                    fnc: 'modifyArrayConfig',
                    permission: 'master'
                },
            ]
        });
        this.configPath = './plugins/bl-chat-plugin/config/message.yaml';
        // 此插件与主聊天链路写入同一 Redis key，必须使用同一短期 TTL。
        this.messageManager = new MessageManager(readMessageCacheOptions());
        this.archiveManager = messageArchiveManager;
    }

    parseArchiveSearch(msg = "", e = {}) {
        const text = String(msg || "")
            .replace(/^[.。]群聊天记录\s*/, "")
            .replace(/^#?(查|搜索)(聊天|群聊)记录\s*/, "")
            .trim();
        const opts = {
            type: "group",
            groupId: e.group_id ? String(e.group_id) : "",
            limit: 30,
            around: 0
        };
        const pairs = [
            [/群(?:号)?[=:：]\s*(\d+)/, "groupId"],
            [/(?:qq|QQ|用户|用户QQ)[=:：]\s*(\d+)/, "qq"],
            [/(?:关键词|关键字|key|kw|keyword)[=:：]\s*("[^"]+"|'[^']+'|\S+)/, "keyword"],
            [/(?:正则|regex)[=:：]\s*("[^"]+"|'[^']+'|\S+)/, "regex"],
            [/(?:上下文|周围|context|around)[=:：]?\s*(\d+)/, "contextAround"],
            [/(?:前后|最近)[=:：]?\s*(\d+)/, "around"],
            [/(?:数量|条数|limit)[=:：]?\s*(\d+)/, "limit"],
            [/(?:消息|message_id|mid)[=:：]\s*(\d+)/, "messageId"]
        ];
        for (const [pattern, key] of pairs) {
            const match = text.match(pattern);
            if (match) opts[key] = String(match[1]).replace(/^["']|["']$/g, "");
        }
        const positionalGroup = text.match(/(?:^|\s)(\d{6,12})(?:\s|$)/);
        if (positionalGroup && !/qq|用户|消息|mid/i.test(text.slice(Math.max(0, positionalGroup.index - 8), positionalGroup.index))) {
            opts.groupId = positionalGroup[1];
        }
        if (!opts.keyword) {
            const keywordMatch = text.match(/(?:关键词|关键字)\s+(.+?)(?:\s+(?:前后|数量|条数|群|qq|QQ)[=:：]|\s*$)/);
            if (keywordMatch) opts.keyword = keywordMatch[1].trim();
        }
        opts.contextAround = Math.min(50, Math.max(0, Number(opts.contextAround) || 0));
        opts.around = Math.min(50, Math.max(0, Number(opts.around) || 0));
        if (opts.qq && opts.around && !opts.contextAround) {
            opts.limit = opts.limit === 30 ? opts.around : opts.limit;
            opts.around = 0;
        }
        if (opts.contextAround) opts.around = opts.contextAround;
        opts.limit = Math.min(100, Math.max(1, Number(opts.limit) || 30));
        if (!opts.qq && !opts.keyword && !opts.regex && !opts.messageId) {
            opts.limit = Math.min(opts.limit, 20);
        }
        return opts;
    }

    buildArchiveHelp(e = {}) {
        const groupHint = e.group_id ? `群=${e.group_id}` : "群=953676639";
        return [
            "用法：.群聊天记录 " + groupHint + " [QQ=123456] [key=关键词] [前后=10] [数量=30]",
            "字段：群=群号，QQ=用户QQ，key/关键词=搜索词，前后=最近条数，上下文=带出前后聊天，数量=最多返回条数",
            "管理：.群聊天记录 管理员添加 QQ号 / .群聊天记录 管理员删除 QQ号"
        ].join("\n");
    }

    async showMessagePipelineStatus(e) {
        const runtime = getInstalledMessagePipeline();
        if (!runtime?.store) {
            await e.reply(runtime?.unavailableReason
                ? `消息管道当前不可用：${runtime.unavailableReason}`
                : '消息管道尚未初始化或已关闭');
            return true;
        }
        const groupId = String(e.msg || '').match(/\b\d{5,12}\b/)?.[0] || '';
        try {
            const [allEvents, allDeliveries] = await Promise.all([
                runtime.store.list('event'),
                runtime.store.list('delivery')
            ]);
            const events = groupId
                ? allEvents.filter(job => String(job?.envelope?.groupId || '') === groupId)
                : allEvents;
            const deliveries = groupId
                ? allDeliveries.filter(job => String(job?.groupId || '') === groupId)
                : allDeliveries;
            const summarize = jobs => {
                const counts = new Map();
                for (const job of jobs) {
                    const state = String(job?.state || 'unknown');
                    counts.set(state, (counts.get(state) || 0) + 1);
                }
                return [...counts.entries()].sort().map(([state, count]) => `${state}=${count}`).join('，') || '无';
            };
            const recentProblems = [...events, ...deliveries]
                .filter(job => job?.lastError || job?.uncertain)
                .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
                .slice(0, 5);
            const lines = [
                `消息管道：${runtime.config?.enabled !== false && !runtime.pipeline?.stopped ? '运行中' : '已停止'}${groupId ? `（群 ${groupId}）` : ''}`,
                `事件：${summarize(events)}`,
                `媒体投递：${summarize(deliveries)}`
            ];
            if (recentProblems.length) {
                lines.push('最近异常：');
                for (const job of recentProblems) {
                    lines.push(`[${job.state}] group=${job.groupId || job.envelope?.groupId || 'private'} id=${job.id}${job.uncertain ? '（结果不确定，未自动重试）' : ''}\n${String(job.lastError || '发送结果不确定').slice(0, 180)}`);
                }
            }
            await e.reply(lines.join('\n'));
        } catch (error) {
            logger.error(`[MessagePipeline] 状态查询失败: ${error.stack || error.message}`);
            await e.reply(`消息管道状态查询失败：${error.message}`);
        }
        return true;
    }

    getBilibiliSegment(record = {}) {
        return Array.isArray(record.message)
            ? record.message.find(item => item?.type === 'bilibili') || null
            : null;
    }

    async buildArchiveForwardMessages(records = []) {
        const messages = [];
        const tempFiles = [];
        for (const record of records) {
            const message = [this.archiveManager.formatRecord(record, { compact: true })];
            const bilibili = this.getBilibiliSegment(record);
            if (bilibili) {
                const relay = await buildBilibiliArchiveRelaySegments(bilibili, { logger });
                message.push(...relay.segments);
                tempFiles.push(...relay.tempFiles);
            }
            messages.push({
                user_id: record.user_id || record.sender?.user_id || Bot.uin,
                nickname: record.sender?.card || record.sender?.nickname || String(record.user_id || "未知"),
                message
            });
        }
        return { messages, tempFiles };
    }

    async searchArchive(e) {
        if (/^[.。]群聊天记录\s*$/i.test(String(e.msg || ""))) {
            await e.reply(this.buildArchiveHelp(e));
            return true;
        }
        const opts = this.parseArchiveSearch(e.msg, e);
        if (!opts.groupId) {
            await e.reply(this.buildArchiveHelp(e));
            return true;
        }
        if (!this.archiveManager.canQuery(e, opts.groupId)) {
            await e.reply("只有主人、该群群主或被授权的聊天记录管理员可以查询这个群的记录");
            return true;
        }
        try {
            const records = await this.archiveManager.query(opts);
            if (!records.length) {
                await e.reply("没有查到匹配的聊天记录");
                return true;
            }
            const title = [
                `聊天记录查询：群 ${opts.groupId}`,
                opts.qq ? `QQ=${opts.qq}` : "",
                opts.keyword ? `关键词=${opts.keyword}` : "",
                opts.regex ? `正则=${opts.regex}` : "",
                opts.contextAround ? `上下文=${opts.contextAround}` : "",
                `共 ${records.length} 条`
            ].filter(Boolean).join(" | ");
            logger.info(`[MessageArchive] ${title}`);
            const { messages: forwardMsgs, tempFiles } = await this.buildArchiveForwardMessages(records);
            try {
                const summary = e.group?.makeForwardMsg
                    ? await e.group.makeForwardMsg(forwardMsgs)
                    : forwardMsgs.map(item => Array.isArray(item.message) ? item.message.filter(part => typeof part === 'string').join('') : item.message).join("\n\n");
                await e.reply(summary);
            } finally {
                await cleanupBilibiliArchiveRelayFiles(tempFiles);
            }
        } catch (error) {
            logger.error(`[MessageArchive] 查询失败: ${error.stack || error.message}`);
            await e.reply(`查询失败：${error.message}`);
        }
        return true;
    }

    async manageArchiveAdmin(e) {
        const action = e.msg.includes("删除") ? "delete" : "add";
        const ids = [...String(e.msg || "").matchAll(/\b\d{5,12}\b/g)].map(match => match[0]);
        const groupId = e.group_id ? String(e.group_id) : ids.shift();
        const admins = ids.filter(id => id !== groupId);
        if (!groupId || !admins.length) {
            await e.reply("格式：#聊天记录管理员添加 QQ号（需在群内由群主/主人操作）");
            return true;
        }
        if (!this.archiveManager.canManageGroupAdmins(e, groupId)) {
            await e.reply("只有主人或该群群主可以配置本群聊天记录管理员");
            return true;
        }
        const config = await this.readConfig();
        if (!config) {
            await e.reply("读取配置失败");
            return true;
        }
        const archive = config.pluginSettings.messageArchive ||= {};
        const list = Array.isArray(archive.groupAdmins) ? archive.groupAdmins : [];
        let item = list.find(entry => String(entry.groupId) === String(groupId));
        if (!item) {
            item = { groupId: String(groupId), admins: [] };
            list.push(item);
        }
        item.admins = Array.isArray(item.admins) ? item.admins.map(String) : [];
        if (action === "add") {
            for (const admin of admins) {
                if (!item.admins.includes(String(admin))) item.admins.push(String(admin));
            }
        } else {
            item.admins = item.admins.filter(admin => !admins.includes(String(admin)));
        }
        archive.groupAdmins = list.filter(entry => Array.isArray(entry.admins) && entry.admins.length);
        if (await this.saveConfig(config)) {
            await e.reply(`已${action === "add" ? "添加" : "删除"}本群聊天记录管理员：${admins.join("、")}`);
        } else {
            await e.reply("保存配置失败");
        }
        return true;
    }

    async showHistory(e) {
        const type = e.msg.includes('群聊') ? 'group' : 'private';
        const match = e.msg.match(/(\d+)/);
        let id;

        if (match) {
            id = parseInt(match[1]);
        } else {
            id = type === 'group' ? e.group_id : e.user_id;
        }

        // 权限检查
        if (type === 'group' && !e.group) {
            e.reply('请在群聊中使用群聊记录查询功能');
            return;
        }

        try {
            const messages = await this.messageManager.getMessages(type, id, 20);

            if (!messages || messages.length === 0) {
                await e.reply('暂无消息记录');
                return;
            }

            const forwardMsgs = messages.map(msg => {
                let message;
                if (msg.content.includes('发送了一张图片')) {
                    const match = msg.content.match(/\[(https?:\/\/[^\]]+)\]/);
                    if (match) {
                        message = [
                            segment.image(match[1]),
                            '\n',
                            msg.time
                        ];
                    }
                } else {
                    message = [
                        msg.content,
                        '\n',
                        msg.time
                    ];
                }

                return {
                    user_id: msg.sender.user_id,
                    nickname: msg.sender.nickname,
                    message
                };
            });

            const Summary = type === 'group'
                ? await e.group.makeForwardMsg(forwardMsgs)
                : await e.friend.makeForwardMsg(forwardMsgs);

            await e.reply(Summary);

        } catch (error) {
            logger.error(`获取消息记录失败: ${error}`);
            await e.reply('获取消息记录失败，请查看控制台日志');
        }
    }


    /**
     * 清除消息历史记录
     * @param {Object} e 事件对象
     */
    async clearHistory(e) {
        const type = e.msg.includes('群聊') ? 'group' : 'private';

        // if (!e.isMaster) {
        //     e.reply('只有主人才能清除消息记录哦~');
        //     return;
        // }

        const id = type === 'group' ? e.group_id : e.user_id;

        try {
            await this.messageManager.clearMessages(type, id);
            e.reply(`已清除${type === 'group' ? '群聊' : '私聊'}消息记录`);
        } catch (error) {
            logger.error(`清除消息记录失败: ${error}`);
            e.reply('清除消息记录失败，请查看控制台日志');
        }
    }

    async modifyArrayConfig(e) {
        if (!this.e.isMaster) return false

        const msg = e.msg
        const isAdd = msg.includes('添加')
        const matches = msg.match(/^#全局方案(添加|删除)([\u4e00-\u9fa5a-zA-Z]+)\s*(.+)/)

        if (!matches) {
            e.reply('命令格式错误')
            return false
        }

        const [, action, type, valueStr] = matches
        const configKey = 'allowedGroups'

        const values = valueStr.split(/[,，]\s*/).filter(v => v.trim())

        if (values.length === 0) {
            e.reply('请提供要操作的值')
            return false
        }

        const config = await this.readConfig()
        if (!config) {
            e.reply('读取配置失败')
            return false
        }

        try {
            if (!Array.isArray(config.pluginSettings[configKey])) {
                config.pluginSettings[configKey] = []
            }

            if (isAdd) {
                values.forEach(value => {
                    if (!config.pluginSettings[configKey].includes(value)) {
                        config.pluginSettings[configKey].push(value)
                    }
                })
            } else {
                config.pluginSettings[configKey] = config.pluginSettings[configKey].filter(
                    item => !values.includes(item)
                )
            }

            if (await this.saveConfig(config)) {
                e.reply(`批量${isAdd ? '添加' : '删除'}成功`)
            } else {
                e.reply('保存配置失败')
            }
        } catch (error) {
            logger.error(`修改数组配置失败: ${error}`)
            e.reply('操作失败')
        }
    }

    async readConfig() {
        try {
            const file = fs.readFileSync(this.configPath, 'utf8')
            return YAML.parse(file)
        } catch (error) {
            logger.error(`读取配置文件失败: ${error}`)
            return null
        }
    }

    async saveConfig(config) {
        try {
            const yamlStr = YAML.stringify(config)
            fs.writeFileSync(this.configPath, yamlStr, 'utf8')
            return true
        } catch (error) {
            logger.error(`保存配置文件失败: ${error}`)
            return false
        }
    }
}
