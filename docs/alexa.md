# Alexa

An Alexa skill of your own, called **Kitchen Frame**: "Alexa, ask Kitchen Frame to add eggs to groceries." It adds to
the lists, switches what the frame shows, plays a group of Videos and reads out today's calendar.
The skill stays in **development** on your Amazon account, so nobody else can find or use it, and it
is never published or reviewed.

**Needs:** an Amazon developer account (free, the same sign-in as your Amazon account) and an Echo
signed in to that account. Optional: everything else on the frame works without it.

## What you can say

Start with "Alexa, ask Kitchen Frame to…" or "Alexa, tell Kitchen Frame to…", or say "Alexa, open
Kitchen Frame" and then the request.

**Alexa+ (Amazon's AI Alexa) doesn't route to custom skills reliably.** It decides for itself whether
"ask Kitchen Frame to show the house" is for the skill, and often announces it to every Echo instead
("Announcing on all devices"), answers with its own features (Photo Frame slideshows, "not
available on this device"), or doesn't recognise the skill's name at all. With the original Alexa the
same requests reach the skill every time, with the same name. To go back: say "Alexa, exit Alexa+" to
an Echo, or disable it under Manage Your Alexa+ Access at alexaplus.com. Other skill makers report the
same and give the same advice. (Use two words for the name; Amazon discourages one-word names.)

| Say | What happens |
| --- | --- |
| add eggs to groceries · put eggs on the shopping list · add milk | Adds to Groceries (also when no list is named), in Todoist or Reminders as the list is set up ([lists](lists.md)), and shows Groceries on the frame |
| add call the dentist to my tasks · remind us to call the dentist | Adds to Tasks and shows it |
| show the calendar · go to recipes · switch to videos · show the house | The frame switches to that tab (or Media's music, TV or videos view), waking from the slideshow |
| show notifications · show notices | Opens the notices sheet over whatever is showing |
| hide notifications · close that | Closes whatever sheet is open (notices, an event, a task, the weather, Settings) |
| start the slideshow · go to sleep · show the clock | The clock and photo slideshow, as the Play button does |
| wake up | Leaves the slideshow |
| play Trucks videos · play videos | Plays that Media → Videos group on the frame, least recently played first, muted until someone taps it (the frame's browser needs a tap before it plays sound) |
| what's for dinner | Says tonight's dinner from the Paprika meal plan, and opens its recipe on the frame (Recipes → Meals when there are several) |
| what's on my calendar today · the rundown | Shows Home on the frame and reads its Today card in order: who's up early, today's meals, today's events, bedtime ([rotations](rotations.md)), at the Echo's own time |

In demo mode the frame tells the Worker, and the rundown and dinner read the frame's invented day.

**With Alexa+ on**, words like "today", "calendar", "photos", "slideshow", "open" and "help" were often
taken by Alexa's own features even after the skill's name; the extra phrases (the rundown, go to
sleep, show the clock) avoid them.

The skill's name has to be said. To drop it, make an Alexa **Routine** (Alexa app → More → Routines)
with "When this happens: Voice" set to a phrase like "show the calendar" and the action "Customize →
ask Kitchen Frame to show the calendar".

## How it works

Amazon sends each request to the Worker's `POST /api/alexa` ([alexa.js](../dashboard/worker/alexa.js)).
Tabs, the slideshow and videos reach the frame over its live message connection, the same one a
phone's shared video uses ([music](music.md#videos-youtube-for-the-kids)). If the frame isn't connected,
Alexa says so.

The Worker answers only requests that:

- Amazon signed, checked the way Amazon requires: the certificate comes from Amazon's own address
  (`https://s3.amazonaws.com/echo.api/…`), is current and issued to `echo-api.amazon.com`, the
  request's signature matches it, and the request was sent within the last 150 seconds.
- Are for your skill (`ALEXA_SKILL_ID`).
- Come from your Amazon account, if you set `ALEXA_USER_IDS`. A development skill is only on your
  account's devices anyway; this is a second lock.

## Set it up

1. **Create the skill.** Sign in at [developer.amazon.com/alexa/console/ask](https://developer.amazon.com/alexa/console/ask)
   → **Create Skill**. Name it "Kitchen Frame", choose your locale (English (US) or your own), type
   **Other** → **Custom** model, hosting **Provision your own**, then **Start from Scratch**.
2. **Interaction model.** **Build → Interaction Model → JSON Editor**: paste
   [alexa/interaction-model.json](../alexa/interaction-model.json). In `VIDEO_GROUP`, put your own
   Videos group names (the names in `YOUTUBE_VIDEOS`) in place of the examples, so Alexa hears them
   well. **Save**, then **Build skill**.
3. **Endpoint.** **Build → Endpoint → HTTPS**, Default Region:
   `https://<your worker>.workers.dev/api/alexa`, with the certificate option "My development
   endpoint is a sub-domain of a domain that has a wildcard certificate from a certificate
   authority" (a custom domain with its own certificate: the first option). **Save**.
4. **The skill id.** Copy it from the Endpoint page (**Your Skill ID**, `amzn1.ask.skill.…`) into
   `ALEXA_SKILL_ID` in `dashboard/.dev.vars` and push it (`scripts/push-secrets.sh`, or
   `npx wrangler secret put ALEXA_SKILL_ID`).
5. **Its card in the Alexa app.** **Distribution → Store Preview**: set **Public Name** to the same name
   (the app lists your development skills by it), a one-line and a longer description, and the three
   **Example Phrases** ("Alexa, ask Kitchen Frame what's for dinner", …). **Save**. Nothing is
   published; this is only what the app shows under Skills → Dev.
6. **Turn on testing.** **Test** tab → "Skill testing is enabled in:" **Development**. Type "ask
   kitchen frame what's for dinner" there to try it, then say it to your Echo. After changing the
   invocation name, build again and switch testing Off and back to Development: until then Alexa
   doesn't know the new name.
7. **Usually not needed: your account only.** A development skill already works only on your own
   account's Echos. To lock the Worker to it as well, put your Amazon account id
   (`amzn1.ask.account.…`, in the skill's request JSON on the Test tab) in `ALEXA_USER_IDS` and push
   it. Amazon gives the account a new id whenever the skill is turned off and on again (Test tab →
   Off, then Development), and the skill then answers "this frame only listens to its own
   household" until the new id (in the Worker log's `alexa refused: user …` line) replaces the old.

## When something's wrong

- **"There was a problem with the requested skill's response":** look at `npx wrangler tail`. A
  line starting `alexa refused:` says which check failed (most often `ALEXA_SKILL_ID` not set or not
  matching).
- **Alexa adds the item as something else** ("add eggs" → a different list): name the list, and say
  "to groceries" or "to tasks" at the end.
- **Alexa answers itself** ("not available on this device yet", your Alexa calendar, Amazon Photos):
  it didn't hear the skill's name. Say "Kitchen Frame" clearly, or pick another two-word invocation
  name in the JSON, build again and say that instead.
- **A Videos group isn't found:** add its name to `VIDEO_GROUP` and build again; Alexa reads back
  the groups it has.
