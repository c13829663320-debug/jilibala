export type WelcomeScreenProps = {
  /** 继续（下一步：身份设定）。 */
  onContinue: () => void
  /** 跳过整个引导，直接落地广场。 */
  onSkip: () => void
}

/**
 * R5 引导步骤 1 · 欢迎页：一句话卖点 + 一个继续按钮。
 * 零表单、零输入，3 秒内看懂「这是什么、为什么值得玩」。
 */
export default function WelcomeScreen({ onContinue, onSkip }: WelcomeScreenProps) {
  return (
    <section className="r5ob" aria-label="欢迎来到叽里呱啦">
      <div className="r5ob__kicker">WELCOME TO BALA BALA</div>
      <h1 className="r5ob__title">
        3 分钟，和历史上最有趣的头脑<br />当面聊一句。
      </h1>
      <p className="r5ob__sub">
        选个兴趣，AI 名人立刻化身登场——不用建档案、不用逛广场，开口即对话。
      </p>
      <div className="r5ob__actions">
        <button type="button" className="r5ob__cta" onClick={onContinue}>开始体验 →</button>
        <button type="button" className="r5ob__skip" onClick={onSkip}>先随便逛逛</button>
      </div>
    </section>
  )
}
