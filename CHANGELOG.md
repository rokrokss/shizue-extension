# Changelog

## v0.5.1

- Web search is on by default: the model searches only when the question needs it, and you can see each search (what it looked up, the pages it opened, how many results) in the thinking block as it happens. Turn it off with "Turn off web search" in the Tools menu
- Web search through OpenRouter uses its new search tool, and OpenAI models keep their reasoning effort while they search
- Translate Mode, Memo and Word list are now together in one Study menu on the toolbar
- In a chat with Translate Mode on, answers come from the translation model
- Token usage moved from the chat toolbar to the bottom of Settings → Models
- Setting descriptions and the file types you can attach are now in (i) tooltips, and an empty browser control list is hidden
- Fix the caption menu's language list being hidden under YouTube's top bar or overlapping the menu
- Fix wrong or awkward translations in the interface, in 23 languages
- Fix tooltips flickering when the Tools, Study or Attach menu closes
- Fix Settings running off the side panel when it is taller than the panel; it now scrolls inside it

## v0.5.0

- Browser control does more per step: it can do several actions at once (filling in a whole form in one step), press keys such as Enter, Escape and the arrows, point at a menu to open it, and put one of your images into an upload field
- Your turn: when a page needs you (a sign-in, a CAPTCHA, a choice only you can make), browser control hands the tab over with "Your turn" on the pill and goes on when you press Continue. It can also ask you to click the thing it should use, when it can't tell which one you mean
- Site permission and a plan: before working on a site that is new to the task, browser control asks on a card ("Allow this time" or "Always allow this site"). A longer task, or one that goes to other sites, shows its plan and the sites first, and once you start it, it doesn't ask again for those sites. Sending, paying and deleting still ask each time. Always allowed sites can be removed in Settings → Browser control
- Site tips: when browser control had to search for how to do something on a site (a hidden menu, an unusual flow), it offers a short tip at the end. Remember it, and it reads the tip the next time it works there. Tips can be deleted in Settings
- Run in a separate tab: under browser control in the Tools menu, turn on "Run in a separate tab" and it works in a copy of your tab, in a "Shizue at work" tab group, while you keep using yours. Show its tab or take over at any time
- Fill a form from another tab: right-click a field and choose "Fill this form from an open tab", pick the tab that has the details (a résumé, an order, an email), check the values Shizue proposes and fill them. Shizue never submits the form, and leaves passwords, card numbers and checkboxes to you
- Find in open tabs: turn it on in the Tools menu, and each question looks through your open tabs for the ones that answer it and attaches them
- Search history: turn it on in the Tools menu, and each question looks through your past chats and the pages you visited. You see what was found and choose whether to send it with the question. The search runs on your computer, and banking, payment, health and mail sites are passed over
- Pick up where you left off: a new chat shows your recent chats whose pages are still open, and picking one opens it with those tabs attached again
- Unsent questions are kept: what you typed in a chat box stays there for 7 days, even when you switch chats, open the memo or close the browser
- Link preview: right-click a link and choose "Preview link" to see three key lines of the page and its reading time without opening it
- Look up in this page: select a name or term and choose "Look up in this page" to have it explained from the passages of the page that mention it, each point linked to its passage. Only what you've read so far is used, so nothing ahead is given away
- Attach Office files: Word (.docx), Excel (.xlsx), PowerPoint (.pptx), HWPX and EPUB files can be attached and asked about. An old .hwp file gets a note to save it as HWPX or PDF
- Translation style for Korean and Japanese: in Settings → Page translation, choose formal, polite or plain written style for page translation, or Auto to follow the page. Video and meeting captions keep each speaker's own way of talking
- Fix meeting captions not starting in company Teams that goes through Microsoft Defender for Cloud Apps
- Fix Stop on browser control's pill doing nothing on pages that catch every click
- Fix Claude Haiku 5.5 answers stopping at 4,096 tokens with a Claude API key

## v0.4.2

- Browser control moves faster: it no longer sits through the same pause after every action. It reads the page again as soon as the page has answered, about half a second after a click that changes it instead of more than a second, and waits longer when a new spinner shows more is coming
- Mint captions: the "Yellow translation" caption style is now "Mint translation", in Shizue's color. If you picked it before, you get the new color

## v0.4.1

- Talk to browser control while it works: type in the chat box and press Enter to change or add to the task, and it takes that up at its next step. When it needs something only you know, it asks on a card in the panel and waits for your answer in the chat box
- Browser control stops going in circles: an action repeated on a page that didn't change is pointed out to it once, and the time after it stops and says so
- Browser control sees the screen: with a chat model that reads images, it looks at the tab when the page's text isn't enough, with its controls numbered, and can click a spot on the screen. It can also open a page in a new tab and go back and forth between its tabs
- Site tools: on a site that offers its own tools to AI agents (WebMCP), browser control uses them instead of clicking through the page, and asks first before one that the site says has consequences, or that sends, deletes or pays. Sites without them work as before
- Browser control goes further: a task can take up to 100 steps instead of 25, so longer jobs finish instead of stopping with "Stopped after too many steps". The stop button still ends it at any time
- YouTube captions start sooner and cost less: translation keeps up to 5 minutes ahead of where you are, even while paused, instead of the whole video. Jump to a part not translated yet and it starts there at once. Each line shows as soon as the model writes it, and a line the model skipped is asked for again. During an ad, the video's captions are loaded and the connection to the model opened, so translation starts as soon as it ends. Downloading a subtitle file translates the rest first, with its progress shown
- Translated captions are kept: YouTube, Netflix and other sites' subtitles you've watched show their translation at once for 30 days, without asking the model again
- Highlight spoken words: in the YouTube caption menu, turn on "Highlight spoken words" to color each word of auto-generated captions as it's said. It's off unless you turn it on
- Mint captions: the caption style that showed the translation in yellow now shows it in Shizue's mint
- Move YouTube captions: drag them anywhere in the player, and they stay there for every video. Drag their top right corner to make them larger or smaller, and double-click them to put them back at the bottom
- Captions on more sites: a video with its own caption track on any other site (video.js, Plyr, JW Player and plain HTML players) gets Shizue's captions button at its top right, like lecture videos
- Live captions hear names better: on-device speech recognition listens for the names in the stream's title, channel and category, so a game or a person is written as they are
- Summaries and attached tabs read the page's main content: menus, sidebars, headers, footers, buttons and cookie banners are left out, so the model gets the article itself and the ¶ line numbers point into it. A page with little text that way is read whole, as before
- Claude API key chats cost less: the conversation is cached, so the follow-up questions about a long page, file or video are billed at a tenth for what was already sent (the first question costs a quarter more for it)

## v0.4.0

- Browser control from the page: the top item of Shizue's menu on the page is now Browser control, in place of Memo. It opens the side panel on a new chat with browser control on, even when the panel is closed or showing the memo or word list; a chat that is still answering finishes first. Memo still opens from the memo button in the chat
- Browser control works in embedded forms: contact, booking, sign-up and checkout forms that a page embeds from another site are read, filled in and clicked like the rest of the page. The same rules hold there: it never types into password or card fields, and asks before sending or paying unless "Don't ask first" is on. Frames you can't see are left out, and a CAPTCHA is left for you to solve
- Browser control thinks at High at most: with thinking effort at Extra or Max, each step thinks at High, so steps come sooner, while chat answers keep the level you chose
- Fix browser control stopping partway with a model that thinks, when a step's thinking ran out of room (with an API key or OpenRouter)

## v0.3.25

- Browser control: turn on "Browser control" in the Tools menu and Shizue does what you ask in the current tab, clicking, typing, choosing, scrolling and opening pages one step at a time. The steps show above the answer as it works, and a frame and a pill on the page say it's at work, with a button to stop. Before anything that sends, deletes, pays or can't be undone, it asks you on a card in the panel first. It never types into password or card fields, and treats what the page says as content, not instructions
- Ask Shizue to do something in your tab with browser control off, and a card under the answer offers to turn it on and do it, in one click
- Don't ask first: under browser control in the Tools menu, turn on "Don't ask first" and Shizue sends, deletes and pays in that chat without the approval card. It still never types into password or card fields, and the steps it did without asking are marked. A new chat turns it off
- Tools button: the chat model, web search, browser control and thinking effort have their own button at the right end of the chat box's toolbar. The paperclip now holds what goes with a question: open tabs, files, images and a screen capture. Capturing a part of the page has its own button (the scissors)
- Change the chat model from the Tools menu: it lists the models you can use with the provider you're on (the ChatGPT sign-in models, or those of your API keys and local server). Picking one changes the chat model in Settings too, and thinking effort shows the levels that model takes
- Select all open tabs: the open tabs list in the paperclip menu has "Select all" and "Clear all" at its top right
- Translate images on a page: right-click an image and choose "Translate image", or "Translate all images on page" for a manga chapter or webtoon, and the translation is drawn over each bubble and caption. Hover an image for a button that shows the original. It uses your chat model, so it needs one that reads images, and translated images are kept for 30 days
- Lecture captions: on Coursera, Udemy, TED and Vimeo, hover a video and click the captions button at its top right to read its captions translated, in the caption styles of the other sites. On Udemy, turn on its captions first
- Meeting captions: in Google Meet, Microsoft Teams and Zoom in the browser, turn on the meeting's captions and Shizue's button at the bottom left translates them live, under each speaker's name. Turn on Chrome's on-device translator in the button's menu to keep what is said on your computer; otherwise your translation model translates
- Disney+, Prime Video and Max: turn on the site's captions and click Shizue's button on the player to read them translated
- Long chats keep going: once a chat fills most of the model's context, its older turns are folded into a summary the model reads instead, and the newest stay whole. A chip by the chat box shows how full the context is from half way
- See the model think: models that show their thinking show it above the answer as it comes, folding into "Thought for 12s" once the answer starts, and ChatGPT sign-in models show theirs too
- Thinking effort: in the Tools menu, or in Settings → Models under the chat model, slide to choose how hard the model thinks: Low, Medium or High, and Extra and Max for the GPT-6 and Claude models (Max for DeepSeek). Only the levels the chosen model takes are shown, and a level it doesn't take is sent as its highest. Models that think by default, such as GPT-6.1 Sol, Gemini 4 Argon, Claude Opus 5.5 and Claude Fable 5.1, think at Medium too and show their thinking
- New models: GPT-6 Astra, Gemini 4 Argon, Claude Fable 5.1 and Claude Opus 5.5. Claude Sonnet 5 and Claude Haiku 4.5 make way for Claude Sonnet 5.5 and Claude Haiku 5.5, and DeepSeek V4.1 Flash moves to its 1017 release
- Questions to ask next: under a summary, Shizue suggests a few questions to ask about it; click one to ask it, and the Detailed analysis button follows them
- Ask about the moment: in a chat about a video, the "This moment" chip sends your question with the time the video is at, so "what is this?" is about what's on screen
- Page translation remembers: translations are kept for 30 days, so a page you come back to shows its translation at once, without asking the model again
- Text already in your language isn't sent for translation
- Page translation tells the model what the page is (its title, description and site), so terms are translated in context
- Private details stay on the page: emails, phone numbers, card numbers and API keys aren't sent to the AI when a page is translated. It's on by default, in page translation's settings
- A paragraph whose translation failed gets a retry button; one click tries again every paragraph that failed
- Page translation reaches into web components (open shadow roots), so their text is translated too
- Translation with Gemini 3.8 Flash on a Gemini API key asks for the lowest thinking level the model has, as it has no "minimal"
- Fix the Display row spilling out of the page's translation settings popup

## v0.3.24

- Translation only: in page translation's settings, set Display to "Translation only" to hide the original text and read just the translation. Switching back shows the original again without translating anew
- Code and math stay as they are: code, keyboard keys and formulas inside a translated paragraph keep their original form
- YouTube's auto-generated captions are translated sentence by sentence: the recognizer's broken lines are joined into whole sentences, and long ones split where the speaker pauses
- YouTube captions are translated with the lines around them, as on Netflix: each batch goes with the few lines before it and their translations, and the lines that follow. A sentence split between batches reads as one, and names and terms are more consistent from one batch to the next
- Caption display and style: show the translation only, the original and translation in either order, or the original only, in a default, translucent, outline or yellow-translation style. The choice applies on YouTube, Twitch, Netflix and X
- Save YouTube subtitles as an SRT file: "Save subtitles" in the caption menu downloads the original, the translation, or both. The translation can be saved once it's done, with its progress shown until then
- X videos: hover a video that has captions and click the button at its top right to read them translated
- On a YouTube watch page, speech recognition listens in the language of the audio track playing, following a switch to a dubbed track, or else in the language of the video's auto-generated captions
- Page translation keeps to the content: menus, tabs, buttons, dates, breadcrumbs, tables of contents and text hidden for screen readers stay as they are on every site. On Wikipedia, GitHub, Stack Overflow, Reddit, Hacker News, X, YouTube, LinkedIn, dev.to, Medium and Substack (on publications' own domains too), user cards, counts and sidebars are left out as well, so the article, post and comments are what gets translated. A Hacker News comment is translated whole, its first line included
- Netflix captions can start on their own: Auto-activate in the caption menu has YouTube's choices, judged by the language of the title's original subtitles. A title you turn off stays off, and the next episode starts again
- The toolbar button shows a ✓ on a tab whose page is being translated
- Translations into Arabic, Persian and Urdu read right to left, on pages and in captions, and each translation is marked with its language, so Japanese and Chinese show in their own glyphs on a page in another language
- When a provider turns translation requests away for coming too fast, Shizue waits as long as it asks (or a few seconds) and tries again, up to 3 times, instead of failing. A daily quota or used-up credits still show an error
- Fix the caption toggle showing on vertical YouTube embeds
- Fix page translation skipping the body of some pages, such as MDN's and Substack's
- Fix YouTube captions going blank on a line the model left untranslated (it shows the original now), and a line showing twice in bilingual captions when it has no translation yet

## v0.3.23

- YouTube videos embedded on other sites get Shizue's caption translation too: the toggle sits with the player's own buttons, and the captions and menu fit the player's size

## v0.3.22

- Delete a message you sent: hover it and click the trash icon, and the rest of the conversation after it goes too, since every later answer read it
- Fix bold text not showing in Korean, Japanese and Chinese answers when it ends with a quote or bracket right before the next word

## v0.3.21

- Sources in detailed analysis: with web search on, each finding from the web gets a "Source" chip that opens the page it came from
- Scrolling up while an answer is still coming lets you read: the chat stops following the answer until you scroll back to the bottom
- Summarize a Netflix title: on a watch page, the summary is made from its subtitles, with the times of each part, and the button says "Summarize this video"
- Fix lists in answers showing no bullets or numbers

## v0.3.20

- Summaries fit what you're reading: a paper gets its method, results and limits, news what happened and what comes next, a tutorial its steps in order, a review or investing piece the verdict or outlook for each product or company, a meeting its decisions and action items, and so on for lectures, interviews, essays and recipes
- Scenes in video summaries: each part of a YouTube video's summary shows the frame where that part starts. Click it to play from there
- Page summaries point back to the page: each part has an "Original" button that selects where it starts in the page and scrolls there, or opens the page again if its tab is closed
- Detailed analysis: a button under a summary asks for a longer report that keeps the numbers, names, steps and caveats. With cloud models it also searches the web for what the page doesn't say (who wrote it, whether its key claims hold up, newer figures, opposing views) and works what it finds into the report, saying where each finding comes from
- Chat with a Netflix title: attach a Netflix tab and Shizue reads its subtitles, so times like [12:34] in an answer play it from there
- On YouTube, the summary button and request now say "Summarize this video"

## v0.3.19

- Firefox: Shizue now runs in Firefox, in the sidebar beside the page. The toolbar button and Ctrl+Shift+E (Cmd+Shift+E on Mac) open and close it. On Firefox for Android, it opens in a tab
- Attaching a YouTube tab to a chat now says "Attach this video" instead of "page", and the chat box asks about the attached videos
- The word list's home button is now a back arrow

## v0.3.18

- Chat with a video: attach a YouTube tab and Shizue reads its captions, so answers can say what was said and when. Times like [12:34] in an answer are buttons that play the video from there. The chip shows "with captions", or "without captions" when a video's captions can't be read and its page text is sent instead
- Summaries of a YouTube page are made from its captions, with the times of each part
- Look up caption words: with bilingual captions on YouTube, Netflix or Twitch, click a word in the original line to see its part of speech, base form, reading (Japanese and Chinese) and meaning in that line, from your translation model. The video pauses while it's open (not on live streams) and plays again when you close it
- Word list: save a word from that popup with its line, the line's translation and a link to that moment in the video. The book icon in the side panel opens the list, where you can search, delete and export a CSV for Anki
- Smaller download: math fonts ship only as woff2

## v0.3.17

- Attach files to a chat: the paperclip button and drag-and-drop take text and code files as well as PDFs, and pasting more than 2,000 characters attaches the text as a "Pasted text" chip instead of filling the chat box. Pages, files and pasted text share the limit of 5
- Type @ in the chat box to pick open tabs to attach, searched by title or site. With the tab group permission, the list can also show your tab groups and attach a whole group at once
- Capture an area: from the paperclip button, drag over part of the current tab to send just that part as an image, for models that read images. Esc cancels
- ↑ in an empty chat box brings back this chat's earlier questions, and ↓ goes forward again. Pressing Enter while an answer is still coming stops it and sends your new question instead
- Math in answers is typeset, inline and as blocks, while prices like $5 stay plain text
- Charts: when numbers suit one, answers can draw a bar, line or area chart, with a button to see the same numbers as a table
- Web search: turn it on from the paperclip button and cloud models search the web while answering, with the sources listed under the answer. It stays on until you turn it off. Local models can't search the web
- Auto memory: in Settings → General, turn on "Remember from chats" and Shizue picks out lasting facts about you (your work, how you like answers) from each chat you leave and uses them in later chats. Every fact is listed there to delete one by one or all at once. Off by default
- Fix local model translations arriving all at once instead of streaming in

## v0.3.16

- Attach more to a chat: the paperclip button lists the web pages open in this window to tick on or off, attaches a PDF file from your computer, and captures what the current tab shows as an image for models that read images. Pages and files share the limit of 5
- PDFs: a PDF open in a tab or picked from your computer is read for its text, Korean, Japanese and Chinese included. A scanned PDF with no text isn't sent, with the reason shown
- Search your chats: a search box at the top of History finds conversations by what their messages say and marks the match
- Page translation keeps up with the page: text that appears after translation starts (late-loading paragraphs, infinite scroll, sections that open, a new page in a single-page site) is translated without scrolling, text the page changes is translated again, and text inside frames is translated too

## v0.3.15

- Custom instructions: in Settings → General, tell Shizue about yourself and how you want answers (up to 1,500 characters). Every side panel answer follows them: chat, page summaries, selection actions and image descriptions. Page and caption translation don't use them
- Attach pages to a chat: the tab you're viewing appears above the chat box; click it to send that page's text with your question. Switch tabs to attach up to 5 pages. Attached pages stay with the conversation for follow-up questions, and a page with almost no text or one Shizue can't read isn't sent, with the reason shown
- GPT-6.1 Terra joins the OpenAI and OpenRouter model lists. With Sign in with ChatGPT, GPT-5.6 Terra and GPT-5.6 Terra Pro are no longer offered
- The model list now updates from shizue.net about once a day, so new models can appear without an extension update, and a model you picked that is retired moves to its successor. The request carries no personal data; see the privacy policy

## v0.3.14

- YouTube captions work again on videos YouTube dubbed automatically: Shizue uses the original language's captions instead of a dub's machine-translated ones, and Auto-activate sees the language the video is really spoken in
- YouTube captions: when a video has its own captions in your target language, Bilingual shows the original language's captions with them
- Netflix: opening the caption menu pauses the video and Activate plays it, as on YouTube
- Twitch captions: the "Stream language" row is now "Spoken language", as on YouTube

## v0.3.13

- Bilingual captions on YouTube live streams and on videos without captions: Shizue reads a live stream's captions from YouTube's own, and uses on-device speech recognition when a video has none. The caption menu gains Caption source, Spoken language and Chrome built-in translation rows
- YouTube live captions are read 12–21 seconds ahead from what the player has already downloaded, so LLM translations are ready when a line appears
- YouTube captions: "Auto-activate" in the caption menu turns captions on by themselves for videos spoken in a language you pick, or in any language other than your target language. Deactivate keeps that video off
- The YouTube caption button comes back after a mid-roll ad
- Netflix: the caption button sits before the next-episode button, at the size of Netflix's own buttons, and closed-caption tracks are marked [CC] in the original subtitles list
- Caption menus always show the language list's scrollbar, so it's clear more languages follow

## v0.3.12

- Bilingual captions on Netflix: Shizue shows the title's subtitles in the language being spoken (closed captions first, also on a dub) together with your target language, and you can pick another original track from the caption menu
- When Netflix has subtitles in your target language, Shizue pairs them with the original lines, with no AI request and no API key. Otherwise your LLM translates ahead of playback, with the lines around each batch as context
- Netflix captions show the original right away and fill in translations as they arrive, carry on into the next episode, and work in fullscreen. Netflix has its own Bilingual switch, on by default
- Settings: hide the Netflix caption button
- YouTube captions: Traditional Chinese (zh-Hant) tracks are recognized as Traditional Chinese

## v0.3.11

- Chat replies stay in your chosen language, page summaries included, but when you ask for another language (say, an email draft in English) Shizue now writes it in that language instead of refusing

## v0.3.10

- Twitch captions: the caption menu's "Chrome built-in translation" switch (on by default) picks the translator. On, Chrome's on-device translator translates everything; off, your LLM does. A line's translation no longer changes after it appears
- With the streamer's own captions, Shizue reads them a few seconds ahead from video Twitch's player has already downloaded (up to about 30 seconds on VODs), so LLM translations are ready when a line appears and lines no longer wait for a pause

## v0.3.9

- Twitch live captions translate with Chrome's on-device translator by default and update the line being spoken every 0.3 s; turn on AI translation in the caption menu to use your LLM instead
- Twitch captions show one line at a time (about 80 characters), and each line disappears after 6 seconds
- Twitch auto captions use speech recognition only when on-device recognition is available; picking speech recognition downloads the on-device model right away, and consent is asked only for cloud recognition
- The Twitch caption menu keeps the player controls visible while open, closes when you leave the video and the menu, and opens its submenus to the left
- Twitch captions find the player more reliably
- Sign in with ChatGPT is translated into every supported language

## v0.3.8

- Bilingual captions on Twitch, like on YouTube, for live streams and VODs: Shizue translates the streamer's own captions or Stream Closed Captioner, and recognizes speech on streams without captions (on-device recognition is a one-time download from the caption menu)
- Twitch captions work in theatre mode and fullscreen, and pause while an ad plays

## v0.3.7

- Settings show the panel shortcut you actually have (or "Not set"), and "Change" opens Chrome's shortcut page with the new keys showing up in the panel as soon as you press them

## v0.3.6

- Sign in with ChatGPT now also works on the Shizue Plot website (plot.shizue.net): Shizue passes OpenAI's loopback sign-in callback on to the site, with no new permissions

## v0.3.5

- New look: the mascot and the extension icon are now a blue bunny

## v0.3.4

- Add ChatGPT sign-in and automatically restore disconnected page scripts
- GPT-6 Sol is updated to GPT-6.1 Sol
- Show page translation loaders only for batches currently being translated
- Fix a previous chat briefly appearing when opening a page summary; reopening the side panel starts a new chat while keeping saved history
- Speed up side panel startup and settings opening, and remove repeated loading when reopening settings
- Fix the white flash on dark-mode startup and dark-mode settings and memo icon colors
- Remove the extra Shizue label from the loading screen

## v0.3.3

- Fix Cmd/Ctrl+Shift+E and the in-page toggle not closing the side panel after the browser had been idle for a while

## v0.3.2

- Local models: the settings show what's connected, the server and its models, instead of an address form. When no server is running or it has no models yet, Shizue says what to do and connects on its own once you start the server or download a model. Enter an address only when you need a different one
- The Connect and Validate buttons no longer flash a spinner for checks that finish within a moment

## v0.3.1

- Chat history and the memo list no longer flash their empty message while loading, and the Connect and Validate buttons keep their size while they work
- Local models: clearer message when the connected server has no chat models

## v0.3.0

- Local models: in Settings → Models, choose "Use a Local Model" to use Ollama, LM Studio, or llama.cpp running on your computer, with no API key. Shizue finds the server at its default port, or you can enter its address. Chat and translation can use different local models
- Local models (Ollama): when a text is longer than the model can read at once, only its beginning is used, and a note under the reply says so
- Add Gemma 4 31B (Gemini key or OpenRouter)
- Page translation: fix translation failing while the side panel was open
- Page translation: the loader now shows on pages whose paragraphs keep their line breaks, and on paragraphs still waiting their turn

## v0.2.9

- License: Shizue is now MIT-licensed
- OpenRouter: requests carry `HTTP-Referer: https://shizue.net` and `X-OpenRouter-Title: Shizue`, so usage is counted under the Shizue app on OpenRouter. They identify the app, not you

## v0.2.8

- Context menu: right-click selected text to translate, explain, summarize, or fix its grammar. The answer opens in the side panel chat, quoting the selection and linking its page
- Translating a selection uses the Translate Target Language setting

## v0.2.7

- YouTube captions: fix AI captions not showing up after Activate on some videos
- YouTube captions: the subtitles (CC) button is no longer toggled on every video page load, only on Activate when needed
- YouTube captions: when the AI returns the wrong number of lines for a chunk, it's retried in smaller parts instead of leaving the whole chunk untranslated

## v0.2.6

- Add DeepSeek V4 Pro and DeepSeek V4.1 Flash (OpenRouter only)
- Image upload and the image context menu actions are disabled for models that don't accept images (DeepSeek V4 Pro); earlier images in a thread are left out for them

## v0.2.5

- Chat: tildes (e.g. "3~5") no longer render as strikethrough

## v0.2.4

- Onboarding: fix the provider dropdown showing OpenAI while OpenRouter was selected

## v0.2.3

- Onboarding: OpenRouter is now the first and default option in the provider list

## v0.2.2

- Fix the side panel not opening from the floating button (and its summarize, memo and image actions)
- Settings: OpenRouter is now the first option under AI Provider; the Connection setting is gone
- Each model uses whichever of its provider key and the OpenRouter key is registered; with both, the new "Prefer OpenRouter" checkbox decides

## v0.2.1

- Support OpenRouter: one OpenRouter API key for every model (Settings → Models → Connection)
- Add OpenRouter to the onboarding provider options

## v0.2.0

- Remove PDF translation (the translation server is shut down)
- Update models: GPT-6 Sol/Luna, Gemini 3.8 Flash/3.5 Flash-Lite, Claude Sonnet 5/Haiku 4.5
- Stop sending `temperature` to models that reject it; low-reasoning mode for translation
- Accept new Gemini API key format (`AQ.…`) and fix Anthropic key validation (CORS)
- Sanitize translated HTML before inserting it into pages
- Show provider error details in chat; recover when the stream connection drops
- Fix settings not loaded right after the service worker restarts
- Fix token usage provider/model attribution and streaming usage totals
- Fix page translation assigning translations to the wrong elements
- Limit page text sent for summaries
- Upgrade LangChain 1.x, WXT 0.21, Vite 7, and security patches

## v0.1.15

- Memo App Feature
- fix Chat duplicate issue

## v0.1.14

- Use images in chat
- describe image
- extract text from image
- use A/D key to navigate Youtube captions
- support Anthropic

## v0.1.13

- robust translate mode in chat

## v0.1.10

- limit number of pages in PDF translation

## v0.1.9

- increase PDF translation file limit to 40MB

## v0.1.8

- PDF Translation

## v0.1.7

- API Token Usage Monitoring
- Added ability to hide menu on specific websites

## v0.1.6

- Control Youtube caption size

## v0.1.5

- fix minor bugs

## v0.1.4

- Bilingual mode for Youtube Translation

## v0.1.3

- Support Gemini models
  - Gemini 2.5 Flash
  - Gemini 2.5 Flash Lite

## v0.1.2

- Support Youtube Caption Translation

## v0.1.1

- Support Dark Mode

## v0.1.0

- First Deployment
- Support OpenAI Models
- Side Panel Chat
- Bilingual Reading
- One Click Page Summary
