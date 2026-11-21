
void FUN_004a10f0(undefined8 *param_1,undefined8 param_2,undefined4 param_3,undefined1 param_4,
                 uint param_5)

{
  uint uVar1;
  undefined8 *puVar2;
  
  *param_1 = &PTR_FUN_00fb12a8;
  *(undefined4 *)(param_1 + 2) = 0x10;
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
                    /* try { // try from 004a1170 to 004a1174 has its CatchHandler @ 004a1214 */
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
  *(uint *)((long)puVar2 + 0xc) =
       param_5 >> 0x18 | (param_5 & 0xff0000) >> 8 | (param_5 & 0xff00) << 8 | param_5 << 0x18;
  *puVar2 = 0x3154494e49335354;
                    /* try { // try from 004a11c5 to 004a11cf has its CatchHandler @ 004a11f7 */
  FUN_004a5640(param_1 + 0x11,param_2);
  *(undefined4 *)(param_1 + 0x15) = param_3;
  *(undefined2 *)((long)param_1 + 0xac) = 0;
  *(byte *)(param_1[1] + 10) = *(byte *)(param_1[1] + 10) | 0x40;
  return;
}

