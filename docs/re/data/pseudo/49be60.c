
void FUN_0049be60(undefined4 *param_1,long param_2)

{
  undefined4 uVar1;
  int iVar2;
  undefined8 *puVar3;
  char cVar4;
  undefined8 uVar5;
  undefined8 *puVar6;
  ulong uVar7;
  ulong uVar8;
  undefined **ppuVar9;
  void *pvVar10;
  uint uVar11;
  long lVar12;
  undefined1 local_1a8;
  undefined1 auStack_1a7 [15];
  void *local_198;
  byte local_190 [16];
  void *local_180;
  undefined **local_178;
  undefined4 *local_170;
  undefined **local_168;
  undefined8 uStack_160;
  undefined **local_158;
  undefined **local_150 [8];
  undefined1 local_110 [16];
  undefined1 local_100 [16];
  undefined4 local_f0;
  undefined **local_e8 [17];
  undefined8 local_60;
  undefined4 local_58;
  undefined **local_48;
  undefined **local_40;
  undefined4 *local_38;
  
  uVar1 = *(undefined4 *)(*(long *)(*(long *)(param_2 + 8) + 0x10) + 0xb0);
  *param_1 = 0;
  param_1[4] = 0xd;
  local_38 = param_1 + 5;
  FUN_004a5620();
  *(undefined1 (*) [16])(param_1 + 0x26) = (undefined1  [16])0x0;
  *(undefined1 (*) [16])(param_1 + 0x22) = (undefined1  [16])0x0;
  *(undefined8 *)(param_1 + 0x2a) = 0;
  *(undefined1 (*) [16])(param_1 + 0xe) = (undefined1  [16])0x0;
  *(undefined8 *)(param_1 + 0x12) = 0;
  param_1[0x2c] = uVar1;
  *(undefined8 *)(param_1 + 0x2e) = 0xffffffffffffffff;
  param_1[0x30] = 0;
  *(undefined1 *)(param_1 + 0x31) = 0;
  *param_1 = 2;
  local_170 = param_1;
  if (*(long *)(param_2 + 0x10) == 0) {
    local_158 = &PTR_LAB_00fae798;
    local_e8[0] = &PTR_LAB_00fae8e0;
    local_168 = &PTR_FUN_00fae8b8;
    uStack_160 = 0;
                    /* try { // try from 0049bf58 to 0049bf5f has its CatchHandler @ 0049cb8d */
    FUN_00a4edb0(local_e8,local_150);
    local_60 = 0;
    local_58 = 0xffffffff;
    local_168 = (undefined **)&DAT_00fae770;
    local_e8[0] = &PTR_LAB_00fae7c0;
    local_158 = &PTR_LAB_00fae798;
                    /* try { // try from 0049bf91 to 0049bf98 has its CatchHandler @ 0049cb86 */
    FUN_00a4fac0(local_150);
    local_150[0] = &PTR_LAB_00fae968;
    local_100 = (undefined1  [16])0x0;
    local_110 = (undefined1  [16])0x0;
    local_f0 = 0x18;
                    /* try { // try from 0049bfcf to 0049c011 has its CatchHandler @ 0049cbb9 */
    uVar5 = FUN_00427500(&local_158,
                         "Assertion \"!packetList.empty()\" failed at ../../../../deps/teamspeak_common_lib/src/packet/incomingpacket.cpp:"
                         ,0x6e);
    uVar5 = FUN_00a56570(uVar5,0x167);
    uVar5 = FUN_00427500(uVar5,"; ",2);
    FUN_00427500(uVar5,&DAT_00bebd6a,0);
                    /* try { // try from 0049c012 to 0049c01e has its CatchHandler @ 0049cb84 */
    FUN_004277d0(local_190,local_150);
    local_198 = (void *)0x0;
    auStack_1a7._0_8_ = 0x74656b6361506e49;
    local_1a8 = 0x10;
    auStack_1a7._9_6_ = SUB166((undefined1  [16])0x0,10);
    auStack_1a7[8] = 0;
                    /* try { // try from 0049c04b to 0049c05d has its CatchHandler @ 0049cb5b */
    FUN_0042c200(local_190,0,&local_1a8,0);
    if ((local_1a8 & 1) != 0) {
      operator_delete(local_198);
    }
    if ((local_190[0] & 1) != 0) {
      operator_delete(local_180);
    }
    local_168 = (undefined **)&DAT_00fae770;
    local_e8[0] = &PTR_LAB_00fae7c0;
    local_158 = &PTR_LAB_00fae798;
    local_150[0] = &PTR_LAB_00fae968;
    if ((local_110[0] & 1) != 0) {
      operator_delete((void *)local_100._0_8_);
    }
    FUN_00a4f8b0(local_150);
    FUN_00a59ea0(&local_168);
    thunk_FUN_00a4e4f0(local_e8);
  }
  lVar12 = *(long *)(param_2 + 8);
  if (param_2 == lVar12) {
    lVar12 = param_2;
  }
  else {
    ppuVar9 = &PTR_LAB_00fae798;
    local_178 = &PTR_LAB_00fae968;
    local_48 = &PTR_PTR_00fae7d8;
    local_40 = &PTR_LAB_00fae798;
    do {
      uVar11 = *(uint *)(*(long *)(lVar12 + 0x10) + 0x10);
      if (uVar11 < 0xd) {
        local_e8[0] = &PTR_LAB_00fae8e0;
        local_168 = &PTR_FUN_00fae8b8;
        uStack_160 = 0;
                    /* try { // try from 0049c16a to 0049c179 has its CatchHandler @ 0049cc3b */
        local_158 = ppuVar9;
        FUN_00a4edb0(local_e8,local_150);
        local_60 = 0;
        local_58 = 0xffffffff;
        local_168 = (undefined **)&DAT_00fae770;
        local_e8[0] = &PTR_LAB_00fae7c0;
        local_158 = ppuVar9;
                    /* try { // try from 0049c1b2 to 0049c1b9 has its CatchHandler @ 0049cc34 */
        FUN_00a4fac0(local_150);
        local_150[0] = local_178;
        local_100 = (undefined1  [16])0x0;
        local_110 = (undefined1  [16])0x0;
        local_f0 = 0x18;
                    /* try { // try from 0049c1e5 to 0049c22c has its CatchHandler @ 0049cc42 */
        uVar5 = FUN_00427500(&local_158,
                             "Assertion \"getHeaderSize() <= it->m_DataSize\" failed at ../../../../deps/teamspeak_common_lib/src/packet/incomingpacket.cpp:"
                             ,0x7c);
        uVar5 = FUN_00a56570(uVar5,0x16a);
        uVar5 = FUN_00427500(uVar5,"; ",2);
        FUN_00427500(uVar5,&DAT_00bebd6a,0);
                    /* try { // try from 0049c22d to 0049c23a has its CatchHandler @ 0049cc32 */
        FUN_004277d0(local_190,local_150);
        local_198 = (void *)0x0;
        auStack_1a7._0_8_ = 0x74656b6361506e49;
        local_1a8 = 0x10;
        auStack_1a7._9_6_ = SUB166((undefined1  [16])0x0,10);
        auStack_1a7[8] = 0;
                    /* try { // try from 0049c267 to 0049c277 has its CatchHandler @ 0049cc09 */
        FUN_0042c200(local_190,0,&local_1a8,0);
        if ((local_1a8 & 1) != 0) {
          operator_delete(local_198);
        }
        ppuVar9 = local_40;
        if ((local_190[0] & 1) != 0) {
          operator_delete(local_180);
        }
        local_168 = (undefined **)&DAT_00fae770;
        local_e8[0] = &PTR_LAB_00fae7c0;
        local_158 = ppuVar9;
        local_150[0] = local_178;
        if ((local_110[0] & 1) != 0) {
          operator_delete((void *)local_100._0_8_);
        }
        FUN_00a4f8b0(local_150);
        FUN_00a59ea0(&local_168);
        thunk_FUN_00a4e4f0(local_e8);
        uVar11 = *(uint *)(*(long *)(lVar12 + 0x10) + 0x10);
        param_1 = local_170;
      }
      param_1[4] = uVar11 + param_1[4] + -0xd;
      lVar12 = *(long *)(lVar12 + 8);
    } while (param_2 != lVar12);
    lVar12 = *(long *)(param_2 + 8);
  }
  if ((*(byte *)(*(long *)(*(long *)(lVar12 + 0x10) + 8) + 0xc) & 0x40) == 0) {
                    /* try { // try from 0049c348 to 0049c34c has its CatchHandler @ 0049cbad */
    puVar6 = operator_new__((ulong)(uint)param_1[4]);
    *(undefined8 **)(param_1 + 2) = puVar6;
    puVar3 = *(undefined8 **)(*(long *)(lVar12 + 0x10) + 8);
    uVar5 = *puVar3;
    *(undefined8 *)((long)puVar6 + 5) = *(undefined8 *)((long)puVar3 + 5);
    *puVar6 = uVar5;
    if (param_2 != lVar12) {
      pvVar10 = (void *)((long)puVar6 + 0xd);
      do {
        uVar7 = (ulong)(*(int *)(*(long *)(lVar12 + 0x10) + 0x10) - 0xd);
        memcpy(pvVar10,(void *)(*(long *)(*(long *)(lVar12 + 0x10) + 8) + 0xd),uVar7);
        pvVar10 = (void *)((long)pvVar10 + uVar7);
        lVar12 = *(long *)(lVar12 + 8);
      } while (param_2 != lVar12);
    }
LAB_0049c3a9:
    *(undefined8 *)(param_1 + 0x2e) =
         *(undefined8 *)(*(long *)(*(long *)(param_2 + 8) + 0x10) + 0xb8);
    cVar4 = FUN_0049b240(param_1);
    if (cVar4 == '\0') {
      local_158 = &PTR_LAB_00fae798;
      local_e8[0] = &PTR_LAB_00fae8e0;
      local_168 = &PTR_FUN_00fae8b8;
      uStack_160 = 0;
                    /* try { // try from 0049c40f to 0049c419 has its CatchHandler @ 0049cb4c */
      FUN_00a4edb0(local_e8,local_150);
      local_60 = 0;
      local_58 = 0xffffffff;
      local_168 = (undefined **)&DAT_00fae770;
      local_e8[0] = &PTR_LAB_00fae7c0;
      local_158 = &PTR_LAB_00fae798;
                    /* try { // try from 0049c44b to 0049c452 has its CatchHandler @ 0049cb30 */
      FUN_00a4fac0(local_150);
      local_150[0] = &PTR_LAB_00fae968;
      local_100 = (undefined1  [16])0x0;
      local_110 = (undefined1  [16])0x0;
      local_f0 = 0x18;
                    /* try { // try from 0049c489 to 0049c499 has its CatchHandler @ 0049caf3 */
      FUN_00427500(&local_158,"received Packet is invalid, discarding packet",0x2d);
                    /* try { // try from 0049c49a to 0049c4a6 has its CatchHandler @ 0049caf1 */
      FUN_004277d0(local_190,local_150);
      local_198 = (void *)0x0;
      auStack_1a7._0_8_ = 0x74656b6361506e49;
      local_1a8 = 0x10;
      auStack_1a7._9_6_ = SUB166((undefined1  [16])0x0,10);
      auStack_1a7[8] = 0;
                    /* try { // try from 0049c4d3 to 0049c4e8 has its CatchHandler @ 0049cac8 */
      FUN_0042c200(local_190,2,&local_1a8,0);
      if ((local_1a8 & 1) != 0) {
        operator_delete(local_198);
      }
      if ((local_190[0] & 1) != 0) {
        operator_delete(local_180);
      }
      local_168 = (undefined **)&DAT_00fae770;
      local_e8[0] = &PTR_LAB_00fae7c0;
      local_158 = &PTR_LAB_00fae798;
      local_150[0] = &PTR_LAB_00fae968;
      if ((local_110[0] & 1) != 0) {
        operator_delete((void *)local_100._0_8_);
      }
      FUN_00a4f8b0(local_150);
      FUN_00a59ea0(&local_168,&PTR_PTR_00fae7d8);
      thunk_FUN_00a4e4f0(local_e8);
      local_170[4] = 0;
    }
  }
  else {
                    /* try { // try from 0049c56f to 0049c58c has its CatchHandler @ 0049cbaf */
    pvVar10 = (void *)FUN_0043ba20(&DAT_013116a0);
    if (pvVar10 == (void *)0x0) {
      pvVar10 = operator_new(0x9008);
      memset(pvVar10,0,0x9008);
                    /* try { // try from 0049c59f to 0049c5ad has its CatchHandler @ 0049cbaf */
      FUN_0049f810(&DAT_013116a0);
    }
    iVar2 = param_1[4];
                    /* try { // try from 0049c5b5 to 0049c5bc has its CatchHandler @ 0049cbab */
    local_178 = operator_new__((ulong)(iVar2 - 0xd));
    memset(local_178,0,(ulong)(iVar2 - 0xd));
    lVar12 = *(long *)(param_2 + 8);
    if (param_2 != lVar12) {
      ppuVar9 = local_178;
      do {
        uVar7 = (ulong)(*(int *)(*(long *)(lVar12 + 0x10) + 0x10) - 0xd);
        memcpy(ppuVar9,(void *)(*(long *)(*(long *)(lVar12 + 0x10) + 8) + 0xd),uVar7);
        ppuVar9 = (undefined **)((long)ppuVar9 + uVar7);
        lVar12 = *(long *)(lVar12 + 8);
      } while (param_2 != lVar12);
    }
                    /* try { // try from 0049c619 to 0049c625 has its CatchHandler @ 0049cb97 */
    ppuVar9 = local_178;
    uVar7 = FUN_004a4e00(local_178);
    if (uVar7 == param_1[4] - 0xd) {
                    /* try { // try from 0049c636 to 0049c63d has its CatchHandler @ 0049cb59 */
      uVar7 = FUN_004a4dd0(ppuVar9);
      if (uVar7 < 0x100001) {
        uVar11 = (int)uVar7 + 0xd;
        param_1[4] = uVar11;
                    /* try { // try from 0049c824 to 0049c828 has its CatchHandler @ 0049cb59 */
        puVar6 = operator_new__((ulong)uVar11);
        *(undefined8 **)(param_1 + 2) = puVar6;
        puVar3 = *(undefined8 **)(*(long *)(*(long *)(param_2 + 8) + 0x10) + 8);
        uVar5 = *puVar3;
        *(undefined8 *)((long)puVar6 + 5) = *(undefined8 *)((long)puVar3 + 5);
        *puVar6 = uVar5;
                    /* try { // try from 0049c850 to 0049c85d has its CatchHandler @ 0049ca28 */
        uVar8 = FUN_004a5280(ppuVar9,(long)puVar6 + 0xd,pvVar10);
        if (uVar8 == uVar7) {
          operator_delete__(ppuVar9);
          goto LAB_0049c3a9;
        }
        local_158 = &PTR_LAB_00fae798;
        local_e8[0] = &PTR_LAB_00fae8e0;
        local_168 = &PTR_FUN_00fae8b8;
        uStack_160 = 0;
                    /* try { // try from 0049c8b4 to 0049c8bb has its CatchHandler @ 0049ca1e */
        FUN_00a4edb0(local_e8,local_150);
        local_60 = 0;
        local_58 = 0xffffffff;
        local_168 = (undefined **)&DAT_00fae770;
        local_e8[0] = &PTR_LAB_00fae7c0;
        local_158 = &PTR_LAB_00fae798;
                    /* try { // try from 0049c8ed to 0049c8f4 has its CatchHandler @ 0049ca1c */
        FUN_00a4fac0(local_150);
        local_150[0] = &PTR_LAB_00fae968;
        local_100 = (undefined1  [16])0x0;
        local_110 = (undefined1  [16])0x0;
        local_f0 = 0x18;
                    /* try { // try from 0049c92b to 0049c93b has its CatchHandler @ 0049ca1a */
        FUN_00427500(&local_158,"Command Packet size decompression size mismatch, discarding packet"
                     ,0x42);
                    /* try { // try from 0049c93c to 0049c948 has its CatchHandler @ 0049ca18 */
        FUN_004277d0(local_190,local_150);
        local_198 = (void *)0x0;
        auStack_1a7._0_8_ = 0x74656b6361506e49;
        local_1a8 = 0x10;
        auStack_1a7._9_6_ = SUB166((undefined1  [16])0x0,10);
        auStack_1a7[8] = 0;
                    /* try { // try from 0049c975 to 0049c98a has its CatchHandler @ 0049ca16 */
        FUN_0042c200(local_190,2,&local_1a8,0);
        if ((local_1a8 & 1) != 0) {
          operator_delete(local_198);
        }
        if ((local_190[0] & 1) != 0) {
          operator_delete(local_180);
        }
        local_168 = (undefined **)&DAT_00fae770;
        local_e8[0] = &PTR_LAB_00fae7c0;
        local_158 = &PTR_LAB_00fae798;
        local_150[0] = &PTR_LAB_00fae968;
        if ((local_110[0] & 1) != 0) {
          operator_delete((void *)local_100._0_8_);
        }
        FUN_00a4f8b0(local_150);
        FUN_00a59ea0(&local_168,&PTR_PTR_00fae7d8);
        thunk_FUN_00a4e4f0(local_e8);
        local_170[4] = 0;
      }
      else {
        local_158 = &PTR_LAB_00fae798;
        local_e8[0] = &PTR_LAB_00fae8e0;
        local_168 = &PTR_FUN_00fae8b8;
        uStack_160 = 0;
                    /* try { // try from 0049c68c to 0049c693 has its CatchHandler @ 0049cac1 */
        FUN_00a4edb0(local_e8,local_150);
        local_60 = 0;
        local_58 = 0xffffffff;
        local_168 = (undefined **)&DAT_00fae770;
        local_e8[0] = &PTR_LAB_00fae7c0;
        local_158 = &PTR_LAB_00fae798;
                    /* try { // try from 0049c6c5 to 0049c6cc has its CatchHandler @ 0049ca95 */
        FUN_00a4fac0(local_150);
        local_150[0] = &PTR_LAB_00fae968;
        local_100 = (undefined1  [16])0x0;
        local_110 = (undefined1  [16])0x0;
        local_f0 = 0x18;
                    /* try { // try from 0049c703 to 0049c713 has its CatchHandler @ 0049ca58 */
        FUN_00427500(&local_158,"Command Packet size limit exceeded, discarding packet",0x35);
                    /* try { // try from 0049c714 to 0049c720 has its CatchHandler @ 0049ca56 */
        FUN_004277d0(local_190,local_150);
        local_198 = (void *)0x0;
        auStack_1a7._0_8_ = 0x74656b6361506e49;
        local_1a8 = 0x10;
        auStack_1a7._9_6_ = SUB166((undefined1  [16])0x0,10);
        auStack_1a7[8] = 0;
                    /* try { // try from 0049c74d to 0049c762 has its CatchHandler @ 0049ca2d */
        FUN_0042c200(local_190,2,&local_1a8,0);
        if ((local_1a8 & 1) != 0) {
          operator_delete(local_198);
        }
        if ((local_190[0] & 1) != 0) {
          operator_delete(local_180);
        }
        local_168 = (undefined **)&DAT_00fae770;
        local_e8[0] = &PTR_LAB_00fae7c0;
        local_158 = &PTR_LAB_00fae798;
        local_150[0] = &PTR_LAB_00fae968;
        if ((local_110[0] & 1) != 0) {
          operator_delete((void *)local_100._0_8_);
        }
        FUN_00a4f8b0(local_150);
        FUN_00a59ea0(&local_168,&PTR_PTR_00fae7d8);
        thunk_FUN_00a4e4f0(local_e8);
        local_170[4] = 0;
        *(undefined8 *)(local_170 + 2) = 0;
      }
    }
    else {
      param_1[4] = 0;
      *(undefined8 *)(param_1 + 2) = 0;
    }
    operator_delete__(ppuVar9);
  }
  return;
}

