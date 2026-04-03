/** 与后端 server/index.ts isPrivateIpLocal 对齐，用于判断是否经 frp 等公网 SSH */
export function isPrivateIp(ip: string): boolean {
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|localhost$)/.test(ip);
}
