import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { err, ErrorCode, ok } from '../shared/errors'
import type { NodeTemplate, Project, Result } from '../shared/types'
import { ProjectManager } from './project-manager'
import { findProjectDocument } from './project-launcher'

export const EXAMPLE_PROJECT_NAME = 'Manifest Sample Lab'

const locationTemplate: NodeTemplate = {
  label: 'Location',
  fields: {
    purpose: { type: 'string' },
    status: { type: 'enum', options: ['active', 'maintenance'] },
  },
}

const deviceTemplate: NodeTemplate = {
  label: 'Device',
  fields: {
    serial: { type: 'string' },
    firmware: { type: 'version' },
    status: { type: 'enum', options: ['active', 'maintenance'] },
  },
}

/**
 * Creates a compact, user-owned project that demonstrates templates, snapshots,
 * and a meaningful comparison. Reopening it never overwrites the user's copy.
 */
export async function openExampleProject(
  projectManager: ProjectManager,
  examplesDirectory: string,
): Promise<Result<Project>> {
  const projectPath = join(examplesDirectory, EXAMPLE_PROJECT_NAME)

  if (findProjectDocument(projectPath)) {
    return projectManager.openProject(projectPath)
  }
  if (existsSync(projectPath)) {
    return err(
      ErrorCode.PROJECT_NOT_FOUND,
      `Cannot create the sample project because "${projectPath}" already exists and is not a Manifest project. Rename or remove that folder, then try again.`,
    )
  }

  mkdirSync(examplesDirectory, { recursive: true })
  const created = await projectManager.createProject(EXAMPLE_PROJECT_NAME, examplesDirectory)
  if (!created.ok) return created

  const rootId = created.data.nodes[0]?.id
  if (!rootId) return err(ErrorCode.INVALID_HIERARCHY, 'The sample project root could not be created')

  const locationTemplateResult = projectManager.templateCreate('location', locationTemplate)
  if (!locationTemplateResult.ok) return locationTemplateResult
  const deviceTemplateResult = projectManager.templateCreate('device', deviceTemplate)
  if (!deviceTemplateResult.ok) return deviceTemplateResult

  const room = projectManager.nodeCreate(rootId, 'Systems Room', 'location')
  if (!room.ok) return room
  const roomUpdated = projectManager.nodeUpdate(room.data.nodes.at(-1)?.id ?? '', {
    properties: { purpose: 'Integration testing', status: 'active' },
  })
  if (!roomUpdated.ok) return roomUpdated

  const rack = projectManager.nodeCreate(room.data.nodes.at(-1)?.id ?? '', 'Rack A', 'location')
  if (!rack.ok) return rack
  const rackUpdated = projectManager.nodeUpdate(rack.data.nodes.at(-1)?.id ?? '', {
    properties: { purpose: 'Navigation systems', status: 'active' },
  })
  if (!rackUpdated.ok) return rackUpdated

  const controller = projectManager.nodeCreate(rack.data.nodes.at(-1)?.id ?? '', 'Navigation Controller', 'device')
  if (!controller.ok) return controller
  const controllerId = controller.data.nodes.at(-1)?.id
  if (!controllerId) return err(ErrorCode.INVALID_HIERARCHY, 'The sample controller could not be created')
  const controllerUpdated = projectManager.nodeUpdate(controllerId, {
    properties: { serial: 'NAV-042', firmware: '1.3.0', status: 'active' },
  })
  if (!controllerUpdated.ok) return controllerUpdated

  const powerSupply = projectManager.nodeCreate(rack.data.nodes.at(-1)?.id ?? '', 'Power Supply', 'device')
  if (!powerSupply.ok) return powerSupply
  const powerSupplyId = powerSupply.data.nodes.at(-1)?.id
  if (!powerSupplyId) return err(ErrorCode.INVALID_HIERARCHY, 'The sample power supply could not be created')
  const powerSupplyUpdated = projectManager.nodeUpdate(powerSupplyId, {
    properties: { serial: 'PS-017', firmware: '2.1.0', status: 'active' },
  })
  if (!powerSupplyUpdated.ok) return powerSupplyUpdated

  const baseline = await projectManager.snapshotCreate('baseline-lab')
  if (!baseline.ok) return { ok: false, error: baseline.error }

  const upgradedController = projectManager.nodeUpdate(controllerId, {
    properties: { serial: 'NAV-042', firmware: '1.4.0', status: 'maintenance' },
  })
  if (!upgradedController.ok) return upgradedController

  const telemetry = projectManager.nodeCreate(rack.data.nodes.at(-1)?.id ?? '', 'Telemetry Gateway', 'device')
  if (!telemetry.ok) return telemetry
  const telemetryId = telemetry.data.nodes.at(-1)?.id
  if (!telemetryId) return err(ErrorCode.INVALID_HIERARCHY, 'The sample telemetry gateway could not be created')
  const telemetryUpdated = projectManager.nodeUpdate(telemetryId, {
    properties: { serial: 'TEL-008', firmware: '3.0.0', status: 'active' },
  })
  if (!telemetryUpdated.ok) return telemetryUpdated

  const update = await projectManager.snapshotCreate('firmware-update')
  if (!update.ok) return { ok: false, error: update.error }

  const project = projectManager.getCurrent()
  return project ? ok(project) : err(ErrorCode.PROJECT_NOT_FOUND, 'The sample project could not be opened')
}
