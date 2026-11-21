
void FUN_004a0f90(undefined8 *param_1,undefined8 param_2,undefined4 param_3,undefined1 param_4,
                 void *param_5,int param_6)

{
  uint uVar1;
  undefined8 *puVar2;
  
  *param_1 = &PTR_FUN_00fb12a8;
  *(int *)(param_1 + 2) = param_6 + 0xc;
  *(undefined4 *)(param_1 + 4) = 0;
  param_1[0xe] = 0;
  param_1[0xf] = 0;
  param_1[0xc] = 0;
  param_1[0xd] = 0;
  param_1[0x10] = 0;
  FUN_004a55c0(param_1 + 0x11);
  *(undefined4 *)(param_1 + 0x15) = 0;
  uVar1 = *(uint *)(param_1 + 2);
  if (uVar1 < 0xd) {
    *(undefined4 *)(param_1 + 2) = 0xd;
    uVar1 = 0xd;
  }
  *(undefined2 *)((long)param_1 + 0xac) = 0;
                    /* try { // try from 004a1018 to 004a101c has its CatchHandler @ 004a10cf */
  puVar2 = operator_new__((ulong)uVar1);
  param_1[1] = puVar2;
  param_1[9] = 0;
  param_1[10] = 0;
  param_1[7] = 0;
  param_1[8] = 0;
  param_1[5] = 0;
  param_1[6] = 0;
  param_1[0xb] = 0;
  *param_1 = &PTR_FUN_00fb1318;
  *(undefined1 *)((long)puVar2 + 10) = 0x88;
  *(undefined2 *)(puVar2 + 1) = 0x6500;
  param_1[3] = 0;
  *(undefined1 *)((long)puVar2 + 0xb) = param_4;
  memcpy((void *)((long)puVar2 + 0xc),param_5,(long)param_6);
  *puVar2 = 0x3154494e49335354;
                    /* try { // try from 004a1083 to 004a108f has its CatchHandler @ 004a10b2 */
  FUN_004a5640(param_1 + 0x11,param_2);
  *(undefined4 *)(param_1 + 0x15) = param_3;
  *(undefined2 *)((long)param_1 + 0xac) = 0;
  return;
}

