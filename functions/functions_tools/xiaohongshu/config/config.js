// 浏览器指纹。不要把真实值提交到仓库，按需通过环境变量注入。
export const b1 = process.env.XHS_B1 || ""
// 账号 cookie a1 字段。
export const cookie_a1 = process.env.XHS_COOKIE_A1 || ""
// 请求的完整 cookie。
export const my_cookie = process.env.XHS_COOKIE || (cookie_a1 ? `a1=${cookie_a1}` : "")
export const baseURL="https://edith.xiaohongshu.com"
