import { db, C } from '../db/index.js';
import { withStatus } from './deviceStatus.js';

// Loads the small reference collections used to enrich list responses with
// human-readable names (homeowner, household, device) in one pass.
export async function loadLookups() {
  const [users, houses, devices] = await Promise.all([
    db.list(C.users),
    db.list(C.houses),
    db.list(C.devices),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const houseById = new Map(houses.map((h) => [h.id, h]));
  const deviceById = new Map(devices.map((d) => [d.id, withStatus(d)]));

  return {
    users,
    houses,
    devices: [...deviceById.values()],
    userById,
    houseById,
    deviceById,
    describeHouse(houseId) {
      const house = houseById.get(houseId);
      const owner = house ? userById.get(house.userId) : null;
      return {
        houseName: house?.houseName ?? null,
        address: house?.address ?? null,
        ownerId: owner?.id ?? null,
        ownerName: owner?.fullName ?? null,
      };
    },
    deviceName: (id) => deviceById.get(id)?.deviceName ?? null,
  };
}
