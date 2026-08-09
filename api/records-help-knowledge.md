# N3XRA Records Help Knowledge

Last reviewed against the Records interface and permission code: 2026-07-31

## Purpose
N3XRA Records helps organizations store, search, preview, download, share, and publish records, meeting packets, agendas, documents, and meeting-note recordings.

Ask Records AI answers product and workflow questions about N3XRA Records. It is read-only and cannot click controls or complete actions. It should not answer questions about what the user's files say. For file-content questions, direct users to **Library** and **AI Search**.

## Verified navigation
- On desktop, the persistent left navigation has a Workspace group with **Library**, **Meeting Notes**, **Document Builder**, and **Communication**.
- **Workspace** is a fixed group label, not an expandable control. Never tell a user to expand Workspace.
- On desktop, **Manage library** is expandable. It contains **Library settings**, **Templates**, **Phone Meetings**, **AI settings**, **Users**, **Contacts**, **Invites & access**, **Storage**, **Billing**, **Audit activity**, and **N3XRA support access**.
- On desktop, **Profile** appears in the Account group.
- There is no desktop navigation destination labeled **Files** or **Admin Settings**. Files and search are sections inside **Library**.
- On mobile, tell the user to open the header menu before choosing a destination. Do not describe a persistent left navigation on mobile.
- **Library** contains Keyword search, AI Search, and the Files section.
- **Meeting Notes** contains the linked notes, audio, transcript, AI review, and AI Draft workflow.
- **Document Builder** creates and edits app-native documents.
- **Communication** sends branded announcements that are not tied to a document.

## Plans and limits
- The only current Records plans are **Free**, **Starter**, and **Organization**. Never invent Standard, Professional, Enterprise, or other plan names.
- **Free** is $0 per month: 25 private documents, 1 user, 1 GB storage, and 20 Records AI requests per month.
- **Starter** is $12 per month or $115 per year: 1,000 private documents, 1 user, 10 GB storage, and 300 Records AI requests per month.
- **Organization** is $39 per month or $375 per year: 10,000 private documents, up to 15 users, 50 GB storage, and 1,500 Records AI requests per month.
- Organization includes shared libraries and invite codes, a dedicated public-records URL, embedded search and records views, and Meeting Notes.
- Meeting Notes requires the active library to be on Organization. A role upgrade alone does not unlock it on Free or Starter.
- On desktop, exact current plan details are under **Manage library** → **Billing**.

## Roles and permissions
- The membership roles are **Account Admin**, **Editor**, and **Viewer**. **Owner** is a separate billing and ownership status, not a fourth membership role.
- Account Admin manages library settings, users, invite codes, contacts, templates, access, and documents.
- Editor uploads, edits, deletes, downloads, and shares files; creates documents; and can use Meeting Notes when the library is on Organization.
- Viewer has read-only file access and can download and share documents. A Viewer on an Organization library can open Meeting Notes but cannot create or change meeting notes.
- The billing Owner controls billing, plan changes, and ownership decisions. Do not infer content-editing permission from Owner status; content actions follow the membership role.
- Uploading, creating or changing documents, deleting, and saving meeting notes requires Account Admin or Editor.
- Sharing and downloading are available to any active library member, including Viewer.
- Managing users, invites, library settings, and templates requires Account Admin.
- **Library** shows the active member's role under **Your access**. An Editor or Viewer cannot open **Manage library** → **Users**; tell them to check **Your access** or ask an Account Admin to confirm their role.
- If a control is missing or disabled, check the active library, plan requirement, membership role, and any documented prerequisite. Do not invent a feature toggle.

## Library, Keyword search, and AI Search
- **Keyword** and **AI Search** are modes in the Search section of **Library**. They are not controls inside the Files section.
- Keyword mode searches saved titles and extracted text as the user types. There is no Keyword search icon or submit button.
- The **Year** dropdown narrows Keyword results using the record's saved document-year metadata, not its upload date. **Reset** clears the query and Year filter.
- AI Search can load up to 400 accessible documents from the active library. It ranks them for the question and sends selected excerpts to the model, up to 3,000 characters per selected document and within a total context limit.
- AI Search is not limited by the file-type buttons currently displayed in the Files section. The current AI Search request uses all years.
- AI Search uses saved extracted text. When a file has an editable app-native version, it prefers the current editable text.
- AI Search returns an answer and can suggest matching files. It does not load the full original binary file into the model.
- To use it, open **Library**, select **AI Search**, enter the question in **Ask AI anything about these files**, and press Enter or select **Ask AI**.

### Saved AI memory
- AI Search supports library-level saved memory for stable background facts or preferences.
- When a user asks AI Search to remember something, it prepares a concise proposed memory statement. It does not save that memory automatically.
- A library settings manager must review and confirm the proposal before it becomes saved library memory.
- Before confirmation, never claim that information was saved, remembered, retained, or noted for future searches.
- After confirmation, saved memory can guide later AI Search answers for that library.

## Files and uploads
- On desktop, open **Library**, find the **Files** section, and select **Upload**. Do not tell users to select Files in the left navigation.
- The exact Files section filter buttons are **All**, **Uploaded files**, **Agendas**, and **Supporting documents**.
- Keyword search has a **Year** filter. The current interface does not document a Month filter, a public/private-status filter, or user-defined file tags.
- The upload dialog has **Individual file** and **Batch import** modes.
- Individual file fields include **Document title**, **Year**, **Month**, **File**, and the public-record checkbox when available.
- For an individual upload, **Document title**, **Year**, and **Month** are optional metadata. Choosing a **File** is required. Do not tell the user that every metadata field must be completed.
- After choosing a file, the exact submit label is **Upload and save extracted text**.
- The current interface does not document drag-and-drop, a **Browse** button, an **Open** upload button, or an upload progress bar. Never claim those controls exist.
- Each file row opens its menu with **Action**. It is not labeled **More actions** and is not a three-dot control.
- Depending on the record and permission, exact actions can include **Open**, **Edit details**, **Edit**, **Download**, **Share**, **Make public**, **Make private**, and **Delete**.
- For an uploaded file without an editable version, **Edit** creates or opens an app-native editable document. Do not call the control **Make editable**.
- When an editable app document exists, **Open** uses that current app-native version rather than forcing the original source file.
- Uploaded DOCX files can become editable app documents. Legacy DOC files must be converted to DOCX before upload.
- Supported uploads include PDF, DOCX, TXT, MD, CSV, JSON, HTML, and HTM. A PDF with selectable text becomes searchable. A scanned PDF uploads but needs OCR before search or editing.
- Upload results remain in the upload dialog until the user closes it; do not claim the dialog closes automatically.

## Documents and templates
- App-native documents are the source for in-app editing, PDF generation, sending, and final official versions.
- Documents can be created from meeting-minutes templates, letter templates, or reusable templates.
- On desktop, templates are managed under **Manage library** → **Templates**.
- Account Admin can create, edit, and delete templates.
- **Finalize and send document** opens an AI draft or final meeting document in Document Builder for review, editing, PDF generation, and sending.

## Meeting Notes
- Meeting Notes requires Organization. Account Admin and Editor can create and change meeting notes. Viewer can open the page but cannot create or change them.
- Select **New meeting note**, enter **Meeting title**, and choose a **Document template** or **No template - blank notes**.
- Creating a phone meeting starts in **Meeting Notes** → **New meeting note**. Do not send the user to **Manage library** → **Phone Meetings** unless they are asking about configuration, calling permissions, notice, retention, or usage settings.
- In a new meeting note, **App recording** is the default capture method. Choose **Phone call** to attach only the phone call, or **Both** to keep phone and app audio with the same meeting note.
- After choosing **Phone call**, complete **Meeting title** and **Document template**, then select **Start phone meeting**. The phone option is available only when Phone Meetings is active for the library and the user's role is allowed to start calls.
- A title and template choice are required before saving, starting an app recording, or uploading audio.
- A selected template fills **Notetaker notes** with its structure. **No template - blank notes** starts empty.
- Type notes in **Notetaker notes**. **Save meeting note** can save a notes-only meeting note without any audio.
- **Stop recording** ends microphone capture but does not save or finalize the meeting note. Review the notes and then select **Save meeting note**.
- **Upload recording** attaches an existing audio file. **Scan handwritten note** adds OCR text from a note image to Notetaker notes.
- If browser recording is disabled, verify Organization plan, Account Admin or Editor access, a selected template or blank notes, and MediaRecorder browser support.

## Meeting-note details and AI review
- The saved meeting-note popup tabs are **Details**, **Notes**, **Review**, and **AI Draft**.
- Details shows status, template, AI review status, timing, duration, size, playback, and transcript.
- Notes is editable and autosaves.
- Review shows suggested additions and possible conflicts after comparing notes with the transcript.
- AI Draft contains the generated draft. **Finalize and send document** opens it in Document Builder.
- Notetaker notes are the primary truth; the transcript is supporting evidence.
- Suggested additions should be specific transcript details. Conflicts identify disagreement or low confidence.
- Applying suggestions rewrites the draft cleanly. Regenerating should preserve applied and dismissed decisions where possible.

## Meeting speaker detection and voice profiles
- Speaker detection is enabled by default for newly processed meetings. It does not require an enrolled voice profile.
- With no enrolled voice profiles, the transcript uses generic labels such as **Speaker 1** and **Speaker 2**.
- When one or more workspace members have enrolled, matching voices can use those members' names. Unmatched or uncertain voices remain generic speakers rather than receiving a guessed name.
- Account Admin can turn speaker detection off under **Manage library** → **AI settings** → **Meeting speakers** by clearing **Identify speakers in meeting transcripts**. Turning it off prevents new meeting audio from being sent to pyannoteAI for speaker detection.
- **Voice profiles** is always available under **Manage library** → **People and access** for active library members; opening **Users** first is not required.
- Every active workspace member appears automatically in **Voice profiles**. Enrollment is optional, consent-based, and self-service: each member records their own displayed script in a quiet place, reviews the recording, checks the biometric consent box, and selects **Create voice profile**.
- A short clear sample is enough; longer audio is not automatically better. The saved profile is a voiceprint, and N3XRA does not retain the raw enrollment recording.
- Every detected voice starts with a generic speaker label. A name is shown automatically only when the enrolled voice has at least 80% confidence, is clearly ahead of another enrolled voice when alternatives exist, and has at least eight seconds of detected speech. Otherwise the transcript keeps the generic label. No attendance list is required.
- Speaker-aware transcripts are produced for new processing. Existing plain transcripts are not automatically reprocessed.
- Authorized editors can correct a speaker name after processing; the corrected label is applied across that saved transcript and its linked document.
- The correction window includes a play control for each detected speaker. It plays a short excerpt from that speaker's existing meeting audio so an editor can verify who they are before saving a name. Playing the excerpt does not enroll or change a voice profile.

## Sending documents
- In Document Builder, the exact action is **Send document**. There is no two-stage **Send** → **Send document** control.
- The send modal uses **Recipient email**, **Recipients**, **Subject**, and **Message**.
- Delivery options are **Attach PDF**, **Add browser PDF link**, and **Add Records link for account users**.
- Meeting documents can also offer **Attach referenced agenda** and **Attach supporting documents** when applicable.
- The submit button is **Send document**.
- Any active library member, including Viewer, can share a document. Do not claim Editor is required to send.
- For a non-user, the PDF attachment is the primary experience. The optional browser PDF link opens a view-only PDF without requiring a Records account.
- A shared PDF token grants access only to that PDF; it does not grant editing or library access.

## Public records and embeds
- Public URLs and read-only embeds require Organization, enabled public access, and records deliberately marked public.
- Public and embed views prefer the current app-native version when one exists.
- Public lists use the same newest-to-oldest document ordering as the internal library.
- Embed settings include a public page URL, iframe embed code, copy controls, and public-facing search and files views.

## Communication
- **Communication** is for branded announcements not tied to a document, such as meeting reminders, schedule changes, or general updates.
- It reuses account users and contacts as recipients.
- Communication messages do not include document links, app links, PDF links, or attachments.

## Manage library destinations
- **Users**: account users and the path into invite-code creation.
- **Voice profiles**: optional consent-based enrollment that lets future meeting transcripts replace generic speaker labels with a member's name.
- **Contacts**: saved document and Communication recipients.
- **Templates**: reusable document templates.
- **Invites & access**: invite codes, member roles, and shared access.
- **Library settings**: library profile and branding.
- **AI settings**: Records AI settings, saved library memory, and **Identify speakers in meeting transcripts**. Speaker detection is on by default; without enrolled voices it uses Speaker 1, Speaker 2, and so on.
- **Billing**: plan, limits, billing management, and subscription status.
- **N3XRA support access**: temporary, scoped customer-authorized support access.

## Inviting someone
- There is no control labeled **Invite user**. To invite someone, open **Manage library** → **Invites & access** → **Invite codes**.
- **Invite codes** contains **Role**, **Uses**, **Expires at**, **Recipient email (optional)**, **Recipient name (optional)**, and **Custom invite message (optional)**.
- **Create invite code** creates a code without sending it. **Create code + send email** creates the code and emails it. A guide may highlight either action but must never submit it for the user.

## N3XRA support access
- N3XRA support has no automatic access to private document names, filenames, file contents, recordings, or transcripts.
- Standard support can see account identity, plan, limits, usage totals, and sanitized system health without seeing private library content.
- On desktop, Account Admin opens **Manage library** → **N3XRA support access**.
- The form has **Reason for access** and the optional scopes **View documents**, **View recordings and transcripts**, **Download files**, and **Change content or settings**.
- The action is **Grant temporary access**. An active grant can be ended with **Revoke access**.
- A grant expires automatically after 24 hours and creates a customer-visible audit trail.
- Do not tell a customer to make a private record public, share a public URL, or add support as a library user when temporary support access is needed.

## Account and troubleshooting
- The master account is at `/account`. Product-specific Records login remains under the Records app paths.
- If a transcript fails, an allowed user can retry from meeting-note details.
- If AI review is disabled, the transcript may not be ready.
- If a public view appears stale, check whether a current editable app-native version exists.
- If one document recipient fails, the system reports that recipient while allowing successful recipients to continue when possible.
