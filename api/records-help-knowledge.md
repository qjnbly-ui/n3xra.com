# N3XRA Records Help Knowledge

Last reviewed: 2026-06-14

## Purpose
N3XRA Records helps organizations store, search, preview, download, share, and publish records, meeting packets, agendas, documents, and meeting-note recordings.

The Need Help assistant answers product and workflow questions about N3XRA Records. It should not answer questions about what the user's files say. For file-content questions, direct users to Library Search and its AI Search mode.

## Current Navigation
- Library: the primary workspace for searching the active library and opening the newest files. It has two main actions: Meeting notes and Files.
- Meeting Notes: create a meeting note from a document template or blank notes, record or upload audio, keep notetaker notes, transcribe audio, review with AI, and finalize the AI draft as an editable document.
- Files: browse and manage all uploaded files and app-native documents in the active library.
- Admin Settings: manage users, contacts, templates, access, library profile, AI settings, and billing.
- Account: user profile, connected apps, display name, password/settings, and sign out.

## Roles and Permissions
- Owner controls billing, plan changes, ownership decisions, and full administration.
- Account Admin manages library settings, invite codes, contacts, templates, access, and day-to-day administration without owning billing.
- Editor uploads, edits, deletes, downloads, shares files, creates documents, and uses meeting-note workflows.
- Viewer has read-only file access with download/share access where allowed.

If a control is missing or disabled, the user may lack the required role, may not have an active library selected, or the feature may not be enabled for that library.

## Library and Search
- Library shows the active library, current access, shared libraries count, search, and newest files.
- Search supports Keyword and AI Search.
- Keyword mode searches saved extracted text.
- AI Search reviews visible file excerpts for the active library and returns a short answer with suggested files.
- Year filters narrow search results.
- Reset clears search filters.

## Files
- Files is for managing uploaded files and app-native documents.
- Document/file lists should show newest records first by document year/month when available, then upload date.
- Actions can include Open, Edit details, Make editable, Download, Share, Make public/private, and Delete.
- For records with an editable app document, Open should open the current app-native version rather than forcing the original source file.
- Delete workflows may ask whether to remove associated app documents or related meeting-note data.
- Uploaded DOCX files can be converted into editable app documents. Legacy DOC files must be converted to DOCX before upload.
- Supported text-style uploads include TXT, MD, CSV, JSON, HTML, and similar extracted-text records. PDF support is planned around OCR/extraction workflows.

## Documents and Templates
- App-native documents are the source for in-app editing, PDF generation, sending, and final official versions.
- Documents can be created from meeting-minutes templates, letter templates, or reusable admin-created templates.
- Templates are managed in Admin Settings under Templates.
- Users can create, edit, and delete templates when their role allows it.
- "Finalize and send document" opens the AI draft/final document in the editable document page so the user can review, edit, generate PDF, and send.

## Meeting Notes
- Meeting Notes is the recommended workflow for meetings because notes, audio, transcript, AI review, and final document stay linked.
- New meeting notes require a meeting title and either a document template or "No template - blank notes" before saving, recording, uploading, or typing notes.
- Choosing a real template fills the notetaker notes area with the template structure.
- Choosing "No template - blank notes" starts from an empty note and saves no selected template ID.
- Save meeting note can save a notes-only meeting note when no audio recording is needed.
- Stop recording ends microphone capture but does not finalize the meeting note. The user should review notes, optionally scan handwritten notes, then choose Save meeting note.
- Upload recording lets the user save an existing audio file as a meeting note.
- Scan handwritten note lets users upload a note photo or screenshot and adds OCR text into the notetaker notes.
- Uploaded audio saves the selected template/blank choice and notes with the recording.
- After a new meeting note is saved, the new-note panel collapses and the saved meeting note popup opens.

## Meeting Note Popup
- The popup tabs are Details, Notes, Review, and AI Draft.
- Details shows status, template, AI review status, started/ended time, duration, size, playback, and the transcript text below the details.
- Transcript text is selectable in Details and is supporting evidence for AI review.
- Notes is editable and autosaves to the meeting note.
- Review shows suggested additions and possible conflicts from AI after comparing notetaker notes with the transcript.
- AI Draft shows the generated draft. The main action is "Finalize and send document", which opens the editable document page.

## AI Review Behavior
- The notetaker notes are the primary truth.
- The transcript is supporting evidence.
- AI should use the template and notes to create a clean final draft, then use the transcript to add safe missing details.
- Suggested additions should be specific transcript details that may improve the document.
- Conflicts should identify places where notes and transcript disagree or confidence is low.
- Applying suggestions rewrites the draft cleanly instead of appending a messy "accepted additions" section.
- Regenerating the AI review should preserve already applied/dismissed decisions where possible.

## Public Records and Embeds
- Public records features include public URLs and embedded read-only records views when public access is enabled and files are marked public.
- Public embeds should prefer the current app-native/editable version when one exists, because that is the corrected source of truth.
- Public record and embed lists should use the same newest-to-oldest document ordering as internal Files and Library views.
- Embed settings include public page URL, iframe embed code, copy buttons, open public page, and public-facing search/files views.

## Sending Documents
- Documents can be sent through an in-app send modal when configured.
- The send modal supports recipients, subject, message, account users/contacts, and sender delivery options.
- N3XRA branding stays in the email. The sender can choose PDF attachment, a browser PDF backup link, and a Records account link for account users.
- For non-users and contacts, the attached PDF is the primary experience. If enabled, the browser PDF backup link opens the shared PDF directly in the browser's native PDF viewer, not the editor.
- Shared PDF links use a permanent unguessable token and do not require the recipient to have a N3XRA account.
- A shared token authorizes viewing that one PDF only; it does not grant editing or full library access.
- Account users can receive an additional N3XRA Records link that opens the document inside the app when they are signed in, or routes them through the app login flow.
- Account contacts live in Admin Settings under Contacts.
- Account users can also appear as send recipients.

## Admin Settings
- Users: view account users and move into invite-code creation when inviting someone.
- Contacts: save recipients for document sending and invite a contact as a user when needed. The new-contact form is expandable.
- Templates: create/edit/delete reusable document templates.
- Access: invite codes, member access, roles, and shared access controls.
- Library: library profile and branding-style settings.
- AI: product AI settings where available.
- Billing: plan, limits, billing management, and subscription status.

## Account and Login
- Master account lives at `/account`.
- Product-specific Records app login remains under the Records app paths.
- On main public pages, Login/Dashboard should route to the master account depending on session state.
- On the master account page, the top button is Sign out.
- Email confirmation errors should tell users to check their email and junk folder.
- Password reset links should return users to the correct app/account flow instead of the plain home page.

## Troubleshooting Guidance
- If recording controls are disabled, confirm a template or "No template - blank notes" is selected, the user has editor/admin access, and the browser supports MediaRecorder.
- If transcript creation fails, the user can retry from the meeting note details when allowed.
- If AI review is disabled, the transcript may not be ready yet.
- If files or public embeds show old information, check whether an editable app-native document exists and whether the public view is using the current version.
- If sending fails for one recipient, the system should report which recipient failed while allowing other sends when possible.
