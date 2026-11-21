
void FUN_008a1170(undefined8 *param_1)

{
  uint uVar1;
  byte *pbVar2;
  ulong uVar3;
  long *plVar4;
  uint *puVar5;
  
  *param_1 = &PTR_FUN_00fc42a0;
  pbVar2 = (byte *)param_1[0xc];
  if ((pbVar2 != &DAT_0131a348) && (pbVar2 != (byte *)0x0)) {
    if ((*pbVar2 & 1) != 0) {
      operator_delete(*(void **)(pbVar2 + 0x10));
    }
    operator_delete(pbVar2);
  }
  pbVar2 = (byte *)param_1[0xd];
  if ((pbVar2 != &DAT_0131a348) && (pbVar2 != (byte *)0x0)) {
    if ((*pbVar2 & 1) != 0) {
      operator_delete(*(void **)(pbVar2 + 0x10));
    }
    operator_delete(pbVar2);
  }
  puVar5 = (uint *)param_1[0xb];
  if ((puVar5 != (uint *)0x0) && (param_1[9] == 0)) {
    uVar1 = *puVar5;
    if (0 < (int)uVar1) {
      uVar3 = 0;
      do {
        pbVar2 = *(byte **)(puVar5 + uVar3 * 2 + 2);
        if (pbVar2 != (byte *)0x0) {
          if ((*pbVar2 & 1) != 0) {
            operator_delete(*(void **)(pbVar2 + 0x10));
          }
          operator_delete(pbVar2);
        }
        uVar3 = uVar3 + 1;
      } while (uVar1 != uVar3);
      puVar5 = (uint *)param_1[0xb];
    }
    operator_delete(puVar5);
  }
  param_1[0xb] = 0;
  plVar4 = (long *)param_1[7];
  if ((plVar4 != (long *)0x0) && (*plVar4 == 0)) {
    operator_delete(plVar4);
  }
  plVar4 = (long *)param_1[4];
  if ((plVar4 != (long *)0x0) && (*plVar4 == 0)) {
    operator_delete(plVar4);
  }
  if ((((param_1[1] & 1) != 0) &&
      (plVar4 = (long *)(param_1[1] & 0xfffffffffffffffe), plVar4 != (long *)0x0)) &&
     (plVar4[1] == 0)) {
    if (*plVar4 != 0) {
                    /* try { // try from 008a1275 to 008a127c has its CatchHandler @ 008a1297 */
      FUN_008ebb90(plVar4);
    }
    operator_delete(plVar4);
  }
  param_1[1] = 0;
  return;
}

