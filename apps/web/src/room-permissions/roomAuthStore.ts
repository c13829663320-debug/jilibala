// R4-02: 房间密码临时存储——加入密码房时由大厅设置，WS 连接时读取。
// 模块级变量，避免修改 App.tsx 状态流转。
let pendingPassword = "";

export function setRoomPassword(pw: string): void {
  pendingPassword = pw;
}

export function getRoomPassword(): string {
  return pendingPassword;
}

export function clearRoomPassword(): void {
  pendingPassword = "";
}
