import { AbstractTool } from "./AbstractTool.js"

export class SendGiftTool extends AbstractTool {
  constructor() {
    super()

    this.name = "sendGiftTool"
    this.description = "发送QQ礼物给指定用户，支持多种礼物类型（如香槟、风暴战锤、遨游太空、蹦迪派对、露营、龙腾万里、超级跑车、直升机等）"

    this.parameters = {
      type: "object",
      properties: {
        targetQQ: {
          type: "string",
          description: "接收礼物的QQ号（必填）"
        },
        targetNickname: {
          type: "string",
          description: "接收礼物的人的昵称（必填）"
        },
        senderQQ: {
          type: "string",
          description: "发送礼物的QQ号（可选，默认使用机器人QQ号）"
        },
        senderNickname: {
          type: "string",
          description: "发送礼物的人的昵称（可选，默认使用机器人昵称）"
        },
        giftType: {
          type: "string",
          description: "礼物类型，可选值：champagne(香槟)、hammer(风暴战锤)、space(遨游太空)、party(蹦迪派对)、camping(露营)、dragon(龙腾万里)、supercar(超级跑车)、helicopter(直升机)，默认为champagne",
          enum: ["champagne", "hammer", "space", "party", "camping", "dragon", "supercar", "helicopter"]
        }
      },
      required: ["targetQQ", "targetNickname"]
    }

    // 礼物配置映射
    this.giftConfigs = {
      champagne: {
        name: "香槟",
        coinValue: 182,
        tianquanId: 2179,
        displayValue: 199999
      },
      hammer: {
        name: "风暴战锤",
        coinValue: 1388,
        tianquanId: 2025,
        displayValue: 1388
      },
      space: {
        name: "遨游太空",
        coinValue: 1888,
        tianquanId: 1682,
        displayValue: 1888
      },
      party: {
        name: "蹦迪派对",
        coinValue: 2999,
        tianquanId: 2026,
        displayValue: 2999
      },
      camping: {
        name: "露营",
        coinValue: 388,
        tianquanId: 2023,
        displayValue: 388
      },
      dragon: {
        name: "龙腾万里",
        coinValue: 11888,
        tianquanId: 1633,
        displayValue: 199999
      },
      supercar: {
        name: "超级跑车",
        coinValue: 1314,
        tianquanId: 2027,
        displayValue: 1314
      },
      helicopter: {
        name: "直升机",
        coinValue: 18880,
        tianquanId: 1000000110,
        displayValue: 18888
      }
    }
  }

  async func(opts, e) {
    const targetQQ = String(opts.targetQQ || "").trim()
    const targetNickname = String(opts.targetNickname || "").trim()
    const giftType = opts.giftType || "champagne"

    if (!targetQQ) {
      return "error: 目标QQ号不能为空"
    }

    if (!targetNickname) {
      return "error: 目标昵称不能为空"
    }

    const giftConfig = this.giftConfigs[giftType]
    if (!giftConfig) {
      return `error: 未知的礼物类型 ${giftType}`
    }

    // 获取发送者信息：优先使用参数，其次使用机器人信息
    const senderQQ = String(opts.senderQQ || e?.bot?.uin || e?.self_id || "10000")
    const senderNickname = String(opts.senderNickname || e?.bot?.nickname || "机器人").trim()
    
    const pbData = {
      "53": {
        "1": 41,
        "2": {
          "1": 0,
          "2": giftConfig.name,
          "3": parseInt(targetQQ),
          "4": targetNickname,
          "5": parseInt(senderQQ),
          "6": senderNickname,
          "7": giftConfig.displayValue,
          "8": {},
          "10": giftConfig.tianquanId,
          "11": 5,
          "12": "30",
          "13": {
            "1": {
              "2": giftConfig.coinValue
            },
            "2": 9,
            "4": giftConfig.displayValue
          }
        }
      }
    }

    try {
      // 构建完整的消息包
      const packet = {
        "1": {
          "2": {
            "1": e.group_id ? parseInt(e.group_id) : 0
          }
        },
        "2": {
          "1": 1,
          "2": 0,
          "3": 0
        },
        "3": {
          "1": {
            "2": pbData
          }
        },
        "4": this.randomUInt(),
        "5": this.randomUInt()
      }

      const encoded = this.encodePB(packet)
      const hex = this.bytesToHex(encoded)

      const result = await e.bot.sendApi('send_packet', {
        cmd: 'MessageSvc.PbSendMsg',
        data: hex
      })

      if (result) {
        return `成功向 ${targetNickname}(${targetQQ}) 发送 ${giftConfig.name}（${giftConfig.coinValue}金币）`
      } else {
        return `error: 发送礼物失败，未收到响应`
      }
    } catch (error) {
      return `error: 发送礼物失败: ${error.message}`
    }
  }

  // Protobuf 编码辅助函数
  encodePB(obj) {
    const bytes = []
    for (const tag of Object.keys(obj).map(Number)) {
      this._encode(bytes, tag, obj[tag])
    }
    return new Uint8Array(bytes)
  }

  _encode(bytes, tag, value) {
    if (value === undefined) return

    switch (typeof value) {
      case "number":
        this.writeVarint(bytes, (tag << 3) | 0)
        this.writeVarint(bytes, value)
        break
      case "string":
        this.writeVarint(bytes, (tag << 3) | 2)
        const strBytes = new TextEncoder().encode(value)
        this.writeVarint(bytes, strBytes.length)
        bytes.push(...strBytes)
        break
      case "object":
        if (value === null) break
        if (Array.isArray(value)) {
          value.forEach(item => this._encode(bytes, tag, item))
        } else {
          const nested = this.encodePB(value)
          this.writeVarint(bytes, (tag << 3) | 2)
          this.writeVarint(bytes, nested.length)
          bytes.push(...nested)
        }
        break
    }
  }

  writeVarint(bytes, value) {
    while (value > 0x7f) {
      bytes.push((value & 0x7f) | 0x80)
      value >>>= 7
    }
    bytes.push(value & 0x7f)
  }

  bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  randomUInt() {
    return Math.floor(Math.random() * 0xFFFFFFFF) >>> 0
  }
}

export default SendGiftTool
