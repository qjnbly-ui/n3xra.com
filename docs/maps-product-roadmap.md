# N3XRA Maps Product Roadmap

This document records product decisions made during the N3XRA Maps build so that later work extends the same model instead of creating disconnected features.

## Current product principles

- Maps is one reusable, multi-tenant N3XRA product. It must never contain a preassigned customer, organization, user, layer, or demo record.
- Every mapped record belongs to an organization and is protected by database authorization and row-level security.
- A mapped item is an operational asset, not merely a drawing. Its details, files, tasks, incidents, and permanent history stay connected.
- The everyday map must remain clean. Detailed workflows open from the selected asset or from a compact active-work area.
- Submitted history is append-only. Corrections preserve the original record instead of silently replacing it.

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

## Connected utility-network topology (future)

The current line tools draw independent geometry. A future network release must turn those drawings into a connected graph of pipe segments and nodes.

- A new line can snap to an existing endpoint.
- Connecting into the middle of a line creates a junction and splits the original line into connected segments.
- Adding a valve on a pipe splits the pipe into two segments connected through a valve node.
- A 6-inch segment can connect to or continue from a 15-inch segment while each segment retains its own diameter, material, installation date, condition, and history.
- Tee connections create three segments sharing one junction.
- Editing geometry must preserve topology and warn before disconnecting a network.
- The interface must visibly confirm a successful snap or connection.
- Valve state must participate in tracing: an open valve connects the graph and a closed valve isolates it.

## Isolation and affected-customer calculation (future)

Once the network is connected, N3XRA Maps can trace the system from a selected break or proposed valve closure.

- Model sources, pressure zones, junctions, pipe segments, valves, service connections, meters, and current valve state.
- Trace the isolated portion of the network, including branches and loops.
- Highlight the predicted outage area and the valves required for isolation.
- Count affected meters and customer accounts automatically.
- Allow operators to review and correct the result before treating it as authoritative.
- Store the reviewed isolation result with the incident.

A simple flow-direction arrow is not sufficient because real systems can contain loops, multiple sources, pressure zones, and changing valve states.

## Customer communication integration (future)

Customer accounts will eventually connect to meters and service connections. A reviewed isolation result can then produce an affected-recipient list for N3XRA Communications.

- Create an approval step before any communication is sent.
- Support email, permission-based text messages, and automated voice calls.
- Record message templates, recipients, approvals, delivery status, and communication history against the incident.
- Preserve communication consent, account privacy, and organization permissions.
- Keep customer/account, request, notification-batch, and affected-area identifiers available in the Maps data model until the full integration is built.

## Other incident and maintenance work still planned

- Organization-wide active work, overdue tasks, upcoming inspections, and recent activity.
- Task assignment, reassignment, editing, cancellation, recurring schedules, and reminders.
- Specialized workflows for backflow tests, pressure incidents, water samples, blockages, overflows, and customer requests.
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

Do not build yet:

- automatic pipe splitting or topology;
- flow simulation or valve-isolation tracing;
- automatic customer counting;
- outbound email, text, or phone notifications.
