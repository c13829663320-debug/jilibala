// R5: 名人 AI 对话合规免责声明横幅
// 在名人对话/详情场景挂载，提示用户该角色为虚拟 AI，不代表真实人物观点。
export default function ComplianceBanner() {
  return (
    <div
      style={{
        fontSize: 11,
        lineHeight: 1.5,
        color: '#8a8d82',
        background: 'rgba(79,179,165,0.06)',
        border: '1px solid rgba(79,179,165,0.18)',
        borderRadius: 8,
        padding: '6px 10px',
        margin: '6px 0',
      }}
    >
      该角色为 AI 虚拟形象，不代表真实人物观点，对话内容仅供娱乐，不构成任何建议。
    </div>
  )
}
