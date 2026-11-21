
ulong FUN_0049b240(int *param_1)

{
  byte bVar1;
  uint uVar2;
  long *plVar3;
  undefined3 uVar4;
  ulong uVar5;
  byte bVar6;
  
  uVar2 = param_1[4];
  uVar5 = (ulong)uVar2;
  if (uVar2 < 0xd) {
    return 0;
  }
  plVar3 = *(long **)(param_1 + 2);
  bVar1 = *(byte *)((long)plVar3 + 0xc);
  if ((*param_1 != 2) && (*(ushort *)(&DAT_00bb2150 + (ulong)(bVar1 & 0xf) * 2) < uVar2)) {
    return 0;
  }
  switch(bVar1 & 0xf) {
  case 0:
    if (uVar2 < 0x10) {
      return 0;
    }
    break;
  case 1:
    if (uVar2 < 0x10) {
      return 0;
    }
    break;
  case 2:
  case 3:
    if (uVar2 == 0xd) {
      return 0;
    }
    uVar5 = (ulong)(uVar2 - 0xd);
    if ((uVar2 - 0xd < 9) && ((bVar1 & 0x40) != 0)) {
      return 0;
    }
    break;
  case 4:
    if (0xf < uVar2) {
      return 0;
    }
    break;
  case 5:
  case 6:
  case 7:
    if (uVar2 != 0xf) {
      return 0;
    }
    break;
  case 8:
    if (uVar2 < 0xe) {
      return 0;
    }
    if (*plVar3 != DAT_00fd91a0) {
      return 0;
    }
    bVar1 = *(byte *)((long)plVar3 + 0x11);
    uVar4 = (undefined3)(uVar2 >> 8);
    bVar6 = bVar1;
    if ((bVar1 == 0x7f) || (bVar6 = 0xff, 5 < bVar1)) {
      bVar1 = bVar6;
    }
    if (bVar1 == 4) {
      return (ulong)CONCAT31(uVar4,0x13a < uVar2);
    }
    if (bVar1 == 2) {
      return (ulong)CONCAT31(uVar4,uVar2 == 0x26);
    }
    if (bVar1 == 0) {
      return (ulong)CONCAT31(uVar4,uVar2 == 0x22);
    }
    return 0;
  default:
    return 0;
  }
  return CONCAT71((int7)(uVar5 >> 8),1);
}

