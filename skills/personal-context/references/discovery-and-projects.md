# Discovery and project protocol

Use this protocol when finding reusable work, entering a project, or creating one.

## Discover before creating

1. Call `context_status`.
2. Call `list_projects` to obtain stable IDs, names, purposes, and aliases.
3. Build a short search query from the user's intent, important nouns, and likely synonyms.
4. Call `search_context` without a project restriction.
5. For each credible match, call `get_project_context`; normally inspect no more than three candidates.
6. Classify the result:
   - **Strong match:** reuse the existing project and name the evidence.
   - **Possible overlap:** show the candidate and ask whether to extend it or separate it.
   - **No useful match:** propose a new project definition.

Search is semantic work performed by the agent over lexical tool results. Search multiple short variants when vocabulary is uncertain. Treat terminology aliases as equivalent names.

Search and project context return compact event projections by default. Use those summaries to shortlist reusable material, then request `detail: true` only when the body is needed to judge or apply a specific result.

## Enter an existing project

Resolve in this order:

1. Stable project ID when supplied.
2. Exact project name, slug, or alias.
3. `list_projects` plus intent matching.
4. Ask the user only when multiple credible projects remain.

Then call `get_project_context`. Report the resolved project name and ID when the choice was not obvious.

## Define a new project

A project is a long-running learning experiment or body of work, not a topic mentioned once. Prepare:

```text
Name: short canonical name
Purpose: one sentence describing the durable objective
Aliases: existing or likely alternative names
Boundary: what belongs here and what does not
Initial direction: the best current framing
Open questions: uncertainties worth preserving now
```

Creation sequence:

1. Complete discovery first.
2. If overlap is ambiguous, obtain the user's choice.
3. Call `create_project` with name, purpose, and aliases.
4. Call `publish_learning` with an initial `brief`. Put the boundary and initial direction in its summary/details.
5. Publish important initial questions separately as `question` events; do not bury them in the brief.
6. Call `lint_context`.
7. Return the project ID and saved event IDs.

Do not create a new project merely because the current conversation uses a new phrase. Add a terminology alias when it is the same underlying work.

## Reuse decision

- Reuse a **project** when the durable objective and boundary match.
- Reuse or extend a **method** when the procedure can serve the current task with small adaptations.
- Reuse a **term** when the underlying concept matches even if the wording differs.
- Link an **artifact** rather than duplicating it when the original remains authoritative.
- Create a separate project when the objective, ownership boundary, or lifecycle is genuinely independent.
