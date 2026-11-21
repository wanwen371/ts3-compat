
bool FUN_0049b3e0(long param_1,undefined8 param_2,undefined8 param_3)

{
  long lVar1;
  int iVar2;
  undefined8 uVar3;
  int local_17c;
  undefined1 local_178;
  undefined1 auStack_177 [15];
  void *local_168;
  byte local_160 [16];
  void *local_150;
  undefined **local_148;
  undefined8 uStack_140;
  undefined **local_138;
  undefined **local_130 [8];
  undefined1 local_f0 [16];
  undefined1 local_e0 [16];
  undefined4 local_d0;
  undefined **local_c8 [17];
  undefined8 local_40;
  undefined4 local_38;
  
  if (DAT_013116b8 == '\0') {
    iVar2 = __cxa_guard_acquire(&DAT_013116b8);
    if (iVar2 != 0) {
                    /* try { // try from 0049b61b to 0049b626 has its CatchHandler @ 0049b63e */
      DAT_013116b0 = FUN_0074f3d0("rijndael");
      __cxa_guard_release(&DAT_013116b8);
    }
  }
  lVar1 = *(long *)(param_1 + 8);
  iVar2 = FUN_00749a00(DAT_013116b0,param_2,0x10,param_3,0x10,lVar1 + 8,5,lVar1 + 0xd,
                       *(int *)(param_1 + 0x10) + -0xd,lVar1 + 0xd,lVar1,8,&local_17c);
  if (iVar2 != 0) {
    local_138 = &PTR_LAB_00fae798;
    local_c8[0] = &PTR_LAB_00fae8e0;
    local_148 = &PTR_FUN_00fae8b8;
    uStack_140 = 0;
                    /* try { // try from 0049b495 to 0049b49c has its CatchHandler @ 0049b698 */
    FUN_00a4edb0(local_c8,local_130);
    local_40 = 0;
    local_38 = 0xffffffff;
    local_148 = (undefined **)&DAT_00fae770;
    local_c8[0] = &PTR_LAB_00fae7c0;
    local_138 = &PTR_LAB_00fae798;
                    /* try { // try from 0049b4ce to 0049b4d5 has its CatchHandler @ 0049b67e */
    FUN_00a4fac0(local_130);
    local_130[0] = &PTR_LAB_00fae968;
    local_e0 = (undefined1  [16])0x0;
    local_f0 = (undefined1  [16])0x0;
    local_d0 = 0x18;
                    /* try { // try from 0049b50c to 0049b526 has its CatchHandler @ 0049b69d */
    uVar3 = FUN_00427500(&local_138,"Received Error (2) ",0x13);
    FUN_00a56570(uVar3,iVar2);
                    /* try { // try from 0049b527 to 0049b533 has its CatchHandler @ 0049b67c */
    FUN_004277d0(local_160,local_130);
    local_168 = (void *)0x0;
    auStack_177._0_8_ = 0x74656b6361506e49;
    local_178 = 0x10;
    auStack_177._9_6_ = SUB166((undefined1  [16])0x0,10);
    auStack_177[8] = 0;
                    /* try { // try from 0049b560 to 0049b572 has its CatchHandler @ 0049b655 */
    FUN_0042c200(local_160,0,&local_178,0);
    if ((local_178 & 1) != 0) {
      operator_delete(local_168);
    }
    if ((local_160[0] & 1) != 0) {
      operator_delete(local_150);
    }
    local_148 = (undefined **)&DAT_00fae770;
    local_c8[0] = &PTR_LAB_00fae7c0;
    local_138 = &PTR_LAB_00fae798;
    local_130[0] = &PTR_LAB_00fae968;
    if ((local_f0[0] & 1) != 0) {
      operator_delete((void *)local_e0._0_8_);
    }
    FUN_00a4f8b0(local_130);
    FUN_00a59ea0(&local_148,&PTR_PTR_00fae7d8);
    thunk_FUN_00a4e4f0(local_c8);
  }
  return local_17c == 1;
}

