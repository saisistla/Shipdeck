# Live sample: what OpenAI / Claude send at each step

Ticket: **SHIP-200 — Build an application for organic vegetable farming**

These files are examples only. They show the messages. They are not a live API call.

| Step | What happens | Sample file |
| --- | --- | --- |
| 1 | Jira ticket text | `01-jira-ticket.json` |
| 2 | Shipdeck asks the model for a plan | `02-plan-request.txt` |
| 3 | Model returns the architecture | `03-plan-response.json` |
| 4 | You approve in Shipdeck | *(button click, no model file)* |
| 5 | Shipdeck asks the model to write the app | `04-code-request.txt` |
| 6 | Model returns file contents as JSON | `05-code-response.json` |
| 7 | Shipdeck saves those strings on disk | `06-written-project/` |

OpenAI and Claude get the same kind of prompt. Only the HTTP wrapper changes (`chat/completions` vs `messages`). The useful part is the JSON in steps 3 and 6.
