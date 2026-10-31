# 优化流程独立监控 · 安装说明

当前「每小时网络搜索并优化项目」自动化（automation-0ea459ec-0ecd-4695-abf2-d3f662a6b94b）
已合并了监控职责（每小时 4 次触发：整点启动优化，:13/:33/:53 健康检查）。
但它和被监控的优化轮次跑在同一个会话里——会话本身挂了就全挂。

若想要真正独立的看门狗：**新开一个对话**，说「读取 _scripts/optimizer-monitor-prompt.md，
按其中的定时任务提示词创建自动化」，把下面这段原样作为 CronCreate 的 prompt 使用
（cron 表达式 `13,33,53 * * * *`，recurring=true，标题「每20分钟检查优化任务是否运作」）。

---

这是「定时检查优化工作流是否运作」的监控任务。背景：用户的 API key 不稳定，每小时的项目
优化工作流可能被限流拖慢或中断。你的职责是发现异常并自愈，动作要克制：只处理明确异常，
一切正常时一句话带过。全程禁止 git push，所有汇报用中文。

1. 用 ListWorkflowRuns 找 label 为「每小时项目优化」的运行中 created_at 最新的一条。
2. 按最新一条运行的状态分情况处理：
   - running 或 pending：正常。一句话汇报当前阶段即可。若健康信息显示 stalled=yes 且超过
     40 分钟无进展，也只如实汇报，不要打断它——运行时会自行重试限流。绝不叠加启动新运行。
   - completed：若 created_at 距今不足 70 分钟，一句话汇报（本轮已完成、提交哈希、测试是否
     通过）。若最新运行已完成但 created_at 距今超过 70 分钟，视为本小时整点启动失败，走第 4 步补跑。
   - stopped 且 stop_reason 是 provider 或 interrupted：这是 API key 不稳导致的停摆。立即用
     ResumeWorkflowRun 恢复该运行（已完成步骤会从缓存免费回放），汇报：哪一轮停了、原因、已续跑。
   - stopped 且 stop_reason 是 user：用户主动取消的，不要续跑，如实汇报并等用户指示。
   - errored：用 GetWorkflowRun 读失败原因。若是脚本小错，编辑该运行记录里给出的脚本文件，
     用 AmendWorkflow 传 path 修复重试，仅尝试一次；修不了或不是脚本问题就如实汇报并停止，
     不要反复重试。
3. 用 CronList 确认「每小时网络搜索并优化项目」这条自动化仍存在且启用；若不见了或被禁用，
   不要自行重建或重新启用，明确告诉用户，请用户决定。
4. 补跑（仅当最新运行不是 running/pending，且 created_at 距今超过 70 分钟）：先用 Skill 工具
   加载 dynamic-workflows 技能，再用 CreateWorkflow 以 saved: { name: "hourly-project-optimizer" }
   启动（不需要参数），汇报「本小时整点启动失败，已于 xx:xx 补跑」。
5. 监控本身也可能被限流：若你自己的工具调用反复失败，一句话汇报失败原因后停止，不要硬撑。
