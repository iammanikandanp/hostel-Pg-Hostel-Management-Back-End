const router = require('express').Router();
const { hstProtect, hstAdminOnly } = require('../middleware/hstAuth.middleware');
const {
  hstGetAllRooms,
  hstGetRoom,
  hstCreateRoom,
  hstAssignResident,
  hstUpdateCapacity,
  hstUpdateMeterReading,
  hstDeactivateRoom,
} = require('../controllers/hstRoom.controller');

router.get('/',                  hstProtect,               hstGetAllRooms);
router.get('/:id',               hstProtect,               hstGetRoom);
router.post('/',                 hstProtect, hstAdminOnly, hstCreateRoom);
router.post('/:id/assign',       hstProtect, hstAdminOnly, hstAssignResident);
router.patch('/:id/capacity',    hstProtect, hstAdminOnly, hstUpdateCapacity);
router.patch('/meter-reading',   hstProtect, hstAdminOnly, hstUpdateMeterReading);
router.patch('/:id/deactivate',  hstProtect, hstAdminOnly, hstDeactivateRoom);

module.exports = router;
