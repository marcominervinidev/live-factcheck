# Gate 2 CI evidence

PR: https://github.com/marcominervinidev/live-factcheck/pull/2
Push run (ci.yml): https://github.com/marcominervinidev/live-factcheck/actions/runs/36174027767

$ gh pr checks 2
affected workspaces	pass	9s
backend integration · @lfc/service-kit	pass	21s
backend unit · @lfc/contracts	pass	20s
backend unit · @lfc/service-kit	pass	16s
ci passed	pass	4s
contract check	pass	4s
frontend integration · ${{ matrix.workspace.name }}	skipping	0
frontend unit · ${{ matrix.workspace.name }}	skipping	0
pr passed	pass	2s
static (stage 0)	pass	23s

Job timeline (UTC) – backend jobs run in parallel:
  static (stage 0): success 18:32:02–18:32:25
  affected workspaces: success 18:32:02–18:32:11
  backend integration · @lfc/service-kit: success 18:32:14–18:32:35
  backend unit · @lfc/service-kit: success 18:32:14–18:32:30
  backend unit · @lfc/contracts: success 18:32:14–18:32:34
  ci passed: success 18:32:38–18:32:42
