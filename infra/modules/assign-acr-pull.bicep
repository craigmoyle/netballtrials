targetScope = 'resourceGroup'

@description('Existing shared registry that the API and migration job pull from.')
param sharedContainerRegistryName string

@description('Principal ID of the Trials user-assigned managed identity.')
param principalId string

var acrPullRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource sharedContainerRegistry 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = {
  name: sharedContainerRegistryName
}

resource apiAcrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(sharedContainerRegistry.id, principalId, 'AcrPull')
  scope: sharedContainerRegistry
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRoleDefinitionId
  }
}

output roleAssignmentId string = apiAcrPullAssignment.id
