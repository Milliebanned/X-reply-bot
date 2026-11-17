# White Hat Logbook

A step-by-step study plan and logbook for the PortSwigger Web Security Academy path:
51 weeks of lessons plus 14 buffer weeks, from installing Burp Suite to the BSCP exam.

It is one static page (`index.html`) with no build step:

- **Landing page:** smoke hero, a wall of code scenes, a 3D hooded hacker that "hacks in" as you scroll, and an FAQ.
- **Logbook** (`#logbook`): three tabs.
  - **Today:** your current task, split into small numbered steps that each say where to do them (Chrome, Burp, Burp's browser, Terminal or notes), plus a timer.
  - **Weeks:** each week unlocks only when the week before it is done, or after you mark it as done.
  - **Progress:** hours, streak, heatmap, adding time by hand, history and settings.

Progress is saved in the browser. To move it to another device, use **Back up progress** and
**Restore from backup** under Progress → Plan settings.

## Deploy on Vercel

1. In Vercel, choose **Add New → Project** and import this repository.
2. Set **Root Directory** to `white-hat-logbook`.
3. Leave **Framework Preset** as **Other**, with no build command and no output directory.
4. Click **Deploy**.

This folder is separate from the reply bot, so the bot's own Vercel project is not affected.

Not affiliated with PortSwigger. Web Security Academy, Burp Suite and BSCP are PortSwigger products.
