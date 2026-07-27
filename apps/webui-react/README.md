# Superseded — the canonical WebUI is `apps/webui-static`

**Do not build on this directory.** It reserved a TypeScript/React boundary that the
project has since decided against. It holds three files, twelve lines and no component.

`V4-D002` (*TypeScript/React is the canonical WebUI stack*) was **amended** — see
`docs/DECISION_LOG.md` `D-0169`, executing `D-12` of `MASTER_PROJECT/10_DECISIONI.md`.
The shipped interface is `apps/webui-static`: plain JavaScript and CSS, built, tested
and working. React adds nothing this interface requires.

The text this file used to carry described future work — pin versions, generate
lockfiles, audit licences, reproduce the approved static behaviour — that **will not be
done**. Left in place, it read as a technology migration in progress, which is the
"dead schema" category the plan records as *worse than absence*: a reader cannot tell a
reserved boundary from an abandoned one.

`MASTER_PROJECT/03_ARCHITETTURA.md` §6 asks for this directory to be **removed**.
`CLAUDE10.md` rule 12 forbids deletion, and the only removal precedent in this project
(`MASTER_REFERENCE/`) came from an explicit Owner amendment to that file rather than
from a decision taken here. So the directory survives and says what it is; the removal
is open and needs the Owner's word.
