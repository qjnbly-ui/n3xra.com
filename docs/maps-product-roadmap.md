# N3XRA Maps Product Roadmap

This document records product decisions made during the N3XRA Maps build so that later work extends the same model instead of creating disconnected features.

## Current product principles

- Maps is one reusable, multi-tenant N3XRA product. It must never contain a preassigned customer, organization, user, layer, or demo record.
- Every mapped record belongs to an organization and is protected by database authorization and row-level security.
- A mapped item is an operational asset, not merely a drawing. Its details, files, tasks, incidents, and permanent history stay connected.
- Every layer records its infrastructure system and, when created from an N3XRA standard, its stable standard key. Workflows must use this classification instead of guessing from a layer's editable name or color.
- The everyday map must remain clean. Detailed workflows open from the selected asset or from a compact active-work area.
- Submitted history is append-only. Corrections preserve the original record instead of silently replacing it.

## Archive and permanent deletion

- Archiving is reversible. It removes a layer and its mapped items from the active workspace without deleting their operational records.
- Permanent layer deletion is a deliberate account-administrator exception to normal immutability. It is available only after the layer and all of its items are archived.
- The confirmation must explicitly state that the layer, mapped items, immutable history, incidents, incident updates, tasks, photos, linked organization-file records, and layer fields will be destroyed.
- The database purge is one protected transaction. Ordinary event and incident actions must remain unable to update or delete permanent history.
- Stored photo objects are removed through the Storage API before their database records are purged so deleted files do not remain orphaned.

## Break and incident workflow

A water-main break is one continuing incident, not a collection of unrelated forms.

1. **Start incident** with the known information: exact location, linked water line, start time, severity, title, initial description, and an optional estimated number of affected customers.
2. **Respond and update** the same incident through timestamped entries such as crew dispatched, valves closed, area isolated, repair begun, pressure lost or restored, disinfection, sampling, customer notice, and other field notes.
3. **Monitor or test** while laboratory results or system conditions are pending.
4. **Resolve incident** with final cause, repair method, service-restoration time, disinfection and sampling information, customer impact, and closure notes.
5. Closing the incident creates the permanent history record. The incident and every submitted update then remain locked. A later correction is a new linked amendment.

Active incidents must be hard to miss:

- exact incident marker on the map;
- highlighted linked water line;
- severity/status treatment on the map;
- Active Incidents section with a count in the map library;
- one incident screen containing current status and its complete update timeline.

The incident location is stored separately from its parent line. The operator chooses the actual break point, and the system snaps that point to the nearest position on the selected line while preserving the originally reported coordinate and snap distance.

## Connected utility-network topology (in progress)

The first network foundation is now built. Compatible utility lines snap together at their endpoints, store explicit connection records, and can display a saved first-point-to-last-point or reverse flow direction. Point assets can store an explicit relationship to the compatible utility line they serve: meters prefer water-service lines, hydrants prefer their potable-water branch/service line, and other utility assets remain limited to their own infrastructure system. On a potable-water main, **Insert valve** places a standard valve at the chosen location, atomically splits the main into two valid segments, preserves the original segment's records, and stores the valve-to-segment relationship for later tracing.

- A new line can snap to an existing endpoint. **Built.**
- Placing or selecting a meter, hydrant, manhole, inlet, or other utility point can connect or disconnect it from a nearby compatible line. **Built.**
- Connecting into the middle of a line creates a junction and splits the original line into connected segments.
- Adding a valve on a pipe splits the pipe into two segments connected through a stored valve device relationship. **Built for potable-water lines.**
- A 6-inch segment can connect to or continue from a 15-inch segment while each segment retains its own diameter, material, installation date, condition, and history.
- Tee connections create three segments sharing one junction.
- Editing geometry must preserve topology and warn before disconnecting a network.
- The interface must visibly confirm a successful snap or connection.
- Valve state must participate in tracing: an open valve connects the graph and a closed valve isolates it.

## Isolation and affected-customer calculation (in progress)

N3XRA Maps now traces outward from a selected break through explicit line connections until it reaches the first usable valve on every branch. Those boundary valves are the initial isolation plan. If a crew marks one inaccessible or inoperable, tracing passes that valve and expands to the next mapped valve automatically. This handles branches and loops without treating a simple flow-direction arrow as a hydraulic model.

- Trace the isolated portion of the network, including branches and loops. **Built from explicit line and inserted-valve connections.**
- Highlight the predicted outage area and the valves required for isolation. **Built.**
- Guide crews to each required valve and track recommended, en route, found, closed, inaccessible, inoperable, and reopened states. **Built.**
- Recalculate to the next mapped valve when a boundary valve cannot be used. **Built.**
- Count affected connected water meters and distinct customer references automatically. **Built.**
- Save the reviewed isolation result with the incident and lock it when the incident is resolved. **Built.**
- Model and validate supply sources, pressure zones, pumps, tanks, and normally closed valve state for higher-confidence hydraulic operations. **Future.**

The calculation remains an operational estimate until the mapped topology has been reviewed. It explicitly warns when no closed valve boundary can be found or when affected meters are missing customer references.

## Customer communication integration (future)

Customer accounts will eventually connect to meters and service connections. A reviewed isolation result can then produce an affected-recipient list for N3XRA Communications.

- Create an approval step before any communication is sent.
- Support email, permission-based text messages, and automated voice calls.
- Record message templates, recipients, approvals, delivery status, and communication history against the incident.
- Preserve communication consent, account privacy, and organization permissions.
- Keep customer/account, request, notification-batch, and affected-area identifiers available in the Maps data model until the full integration is built.

## Customer-portal request and field-report intake (future)

Customer submissions from a water department's website or customer portal should enter one shared operational intake system and remain traceable across products.

- A customer can request a scheduled service or valve shutoff from the account connected to their meter or service connection.
- A customer can report visible water, suspected leaks, unusual pressure, damaged infrastructure, or another suspicious condition and place or confirm the reported location.
- Every submission receives a request identifier and preserves its source, customer/account reference, contact permissions, submitted location, description, photos, and timestamps.
- A submission may appear in Maps immediately as an **unverified report**, visually distinct from a confirmed break or utility asset.
- Staff review determines whether the submission becomes an inspection task, customer-service request, active incident, maintenance task, or a duplicate linked to existing work.
- Converting a submission links the resulting record back to the original request; it does not copy the information into disconnected forms.
- Customer-visible status updates must expose only approved information. Internal infrastructure, staff notes, other customer identities, and sensitive map data remain private.
- Notifications are triggered from reviewed workflow changes and follow organization rules and customer consent; a public form never sends a system-wide notice by itself.
- Duplicate reports near the same active incident should be grouped for staff review while each customer's original submission remains preserved.

Until customer accounts and portals exist, Maps should keep nullable external request, customer/account, source-channel, and notification references so these integrations can be attached without redesigning incident history.

## Other incident and maintenance work still planned

- Organization-wide active work, overdue tasks, upcoming inspections, and recent activity.
- Task assignment, reassignment, editing, cancellation, recurring schedules, and reminders.
- Specialized workflows for backflow tests, pressure incidents, water samples, blockages, overflows, and customer requests.
- Unified staff intake for unverified customer reports and service requests, with review, conversion, duplicate linking, and customer-safe status updates.
- Files and photos linked directly to an incident, update, event, or task.
- Visible employee attribution and controlled correction/amendment screens.
- Optional historical overlays for prior breaks, overflows, complaints, inspections, and maintenance.
- Compliance and operational exports.

## Implementation boundary for the current break release

Build now:

- active water-main break incidents;
- exact point placement linked to a selected water line;
- map/sidebar highlighting;
- one incident detail view;
- append-only updates;
- structured status progression;
- final closure into immutable history;
- future-safe fields for affected customers, isolation valves, customer requests, and notification batches.

Not built yet:

- flow simulation or valve-isolation tracing;
- automatic customer counting;
- outbound email, text, or phone notifications.
